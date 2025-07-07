let endCursor = "";
const loadedUsers = new Map();
let filteredUsers = [];
let caller = null;

let followUnfollowAttempts = {
  follow: [],
  unfollow: [],
  accept: [],
  reject: [],
};
let isInitialized = false; // Flag to prevent multiple initializations
let isBannerInitialized = false; // Flag to prevent multiple banner initializations

// Cache for pending follow requests
let pendingRequestsCache = {
  users: [],
  timestamp: null,
  cacheDuration: 5 * 60 * 1000 // 5 minutes in milliseconds
};

// Track selected users for bulk actions
const selectedUserIds = new Set();

// DOM element references
let searchGroup;
let overlay;

// Cache management functions
function isCacheValid() {
  return pendingRequestsCache.timestamp && 
         (Date.now() - pendingRequestsCache.timestamp) < pendingRequestsCache.cacheDuration;
}

function updateCache(users) {
  pendingRequestsCache.users = users;
  pendingRequestsCache.timestamp = Date.now();
}

function clearCache() {
  pendingRequestsCache.users = [];
  pendingRequestsCache.timestamp = null;
}

// Abstracted function to fetch pending follow requests
const fetchPendingRequests = async (useCache = true) => {
  // Check cache first if requested
  if (useCache && isCacheValid()) {
    console.log("Using cached pending requests data");
    return pendingRequestsCache.users;
  }

  console.log("Fetching fresh pending requests data...");
  
  try {
    // Step 1: Gather all pending users with pagination
    const allUsers = [];
    let max_id = '';
    let pageCount = 0;
    
    do {
      pageCount++;
      console.log(`Fetching page ${pageCount} of follow requests...`);
      
      const url = max_id ? 
        `https://i.instagram.com/api/v1/friendships/pending/?max_id=${max_id}` :
        `https://i.instagram.com/api/v1/friendships/pending/`;
        
      const response = await fetch(url, {
        method: "GET",
        headers: headers,
        credentials: "include",
        mode: "cors",
      });
      
      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status}`);
      }
      
      const data = await response.json();
      console.log(`Page ${pageCount} returned ${data.users?.length || 0} users`);
      
      if (!data.users || data.users.length === 0) {
        console.log("No more users to fetch");
        break;
      }
      
      allUsers.push(...data.users);
      max_id = data.next_max_id || '';
    } while (max_id);

    console.log(`Total users fetched: ${allUsers.length}`);

    // Step 2: Bulk check follow status (if viewer follows each requestee)
    const followStatuses = {};
    const chunkSize = 100;
    
    for (let i = 0; i < allUsers.length; i += chunkSize) {
      const chunk = allUsers.slice(i, i + chunkSize);
      const userIds = chunk.map(user => user.pk).join(',');
      
      const statusResponse = await fetch('https://i.instagram.com/api/v1/friendships/show_many/', {
        method: 'POST',
        headers: {
          ...headers,
          'content-type': 'application/x-www-form-urlencoded'
        },
        credentials: "include",
        mode: "cors",
        body: `user_ids=${userIds}`
      });
      
      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        Object.assign(followStatuses, statusData.friendship_statuses);
      }
    }

    // Step 3: Helper function to extract mutual count from social_context
    const getMutualCount = (socialContext) => {
      if (!socialContext) return 0;
      const plusMatch = socialContext.match(/\+\s*(\d+)\s+more/);
      const namedCount = (socialContext.match(/, /g) || []).length + 1;
      return plusMatch ? namedCount + parseInt(plusMatch[1]) : namedCount;
    };

    // Step 4: Transform the data with proper relationship info
    const transformedUsers = allUsers.map(user => ({
      node: {
        id: user.pk,
        username: user.username,
        full_name: user.full_name,
        profile_pic_url: user.profile_pic_url,
        followed_by_viewer: followStatuses[user.pk]?.following || false,
        follows_viewer: false,
        requested_by_viewer: false,
        is_pending_request: true,
        mutual_count: getMutualCount(user.social_context),
        social_context: user.social_context
      }
    }))
    .sort((a, b) => {
      const aFollowed = a.node.followed_by_viewer;
      const bFollowed = b.node.followed_by_viewer;
      
      if (aFollowed !== bFollowed) {
        return bFollowed - aFollowed;
      }
      
      return b.node.mutual_count - a.node.mutual_count;
    });
    
    // Update cache
    updateCache(transformedUsers);
    
    return transformedUsers;
  } catch (error) {
    console.error("Error when fetching follow requests from Instagram:", error);
    throw error;
  }
};


function initializeElements() {
  overlay = document.getElementById("overlay");
  searchGroup = document.getElementById("searchGroup");
  
  console.log("Element initialization:", {
    overlay: !!overlay,
    searchGroup: !!searchGroup,
  });
  
  // Check if all critical elements exist
  const allElementsExist = !!(overlay && searchGroup);
  console.log("All critical elements exist:", allElementsExist);
  
  return allElementsExist;
}

function setupEventListeners() {
  // Check if listeners are already attached
  if (document.body.hasAttribute('data-listeners-attached')) {
    console.log("Event listeners already attached, skipping");
    return;
  }

  overlay.addEventListener("click", function (event) {
    if (event.target === this) {
      this.style.display = "none";
    }
  });

  document.getElementById("searchInput").addEventListener("input", function (e) {
    const searchTerm = e.target.value.toLowerCase();
    const usersList = document.getElementById("userList");
    let usersToSearch = [...loadedUsers.values()];
    if (!searchTerm) {
      usersList.innerHTML = "";
      addUsersToDom(usersToSearch);
      return;
    }
    filteredUsers = usersToSearch.filter(
      (user) =>
        user.username.toLowerCase().includes(searchTerm) ||
        user.full_name.toLowerCase().includes(searchTerm)
    );
    usersList.innerHTML = "";
    addUsersToDom(filteredUsers);
  });


  
  // Mark that listeners have been attached
  document.body.setAttribute('data-listeners-attached', 'true');
  console.log("Event listeners setup complete");
}

// Initialize when DOM is ready
function initializeExtension() {
  
  // Prevent multiple initializations
  if (isInitialized) {
    return;
  }
  
  // Show the overlay immediately
  const overlay = document.getElementById("overlay");
  if (overlay) {
    overlay.style.display = "flex";
  }
  
  // Initialize Instagram API first
  if (!initializeInstagramAPI()) {
    console.log("Instagram API not ready, retrying in 1000ms...");
    setTimeout(initializeExtension, 1000);
    return;
  }
  
  console.log("Instagram API initialized, viewerId:", viewerId);
  
  const elementsReady = initializeElements();
  
  // Check if all required elements exist
  if (!elementsReady) {
    setTimeout(initializeExtension, 1000);
    return;
  }
  
  setupEventListeners();
  isInitialized = true;
  
  // Automatically load follow requests when extension starts
  if (viewerId) {
    console.log("Loading follow requests...");
    resetUI();
    fetchFollowRequests();
  } else {
    console.log("No viewerId, showing login message");
    alert("You must be logged in to manage your Instagram followers.");
  }
}

// Function to inject CSS if not already present
function injectCSSIfNeeded() {
  // Check if our CSS is already injected
  if (document.getElementById('ig-follow-request-css')) {
    return;
  }
  
  try {
    // Try to use chrome.runtime.getURL first (extension context)
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      const link = document.createElement('link');
      link.id = 'ig-follow-request-css';
      link.rel = 'stylesheet';
      link.type = 'text/css';
      link.href = chrome.runtime.getURL('style.css');
      document.head.appendChild(link);
    } 
  } catch (error) {
    console.error('Error injecting CSS:', error);
  }
}


function resetUI() {
  loadedUsers.clear();

  searchGroup.style.display = "flex";
}

const fetchFollowRequests = async () => {
  const loader = document.getElementById("loader");
  loader.style.display = "block";
  
  try {
    const transformedUsers = await fetchPendingRequests();
    
    if (transformedUsers.length === 0) {
      alert("You don't have any pending follow requests.");
      return;
    }
    
    updateUIWithData(transformedUsers, "Follow Requests");
  } catch (error) {
    console.error("Error when fetching follow requests from Instagram:", error);
    alert("Error loading follow requests. Please try again later.");
  } finally {
    loader.style.display = "none";
  }
};

function updateUIWithData(edges, functionCalled) {
  document.getElementById("searchInput").style.display = "block";
  const userList = document.getElementById("userList");

  populateLoadedUser(edges, functionCalled);
  userList.innerHTML = "";
  addUsersToDom([...loadedUsers.values()]);
}

function populateLoadedUser(users, functionCalled) {
  if (caller !== functionCalled) {
    caller = functionCalled;
  }
  users.forEach((edge) => {
    const user = edge.node ?? edge;
    if (!loadedUsers.has(user.id)) {
      loadedUsers.set(user.id, user);
    }
  });
}

function addUsersToDom(users) {
  const usersList = document.getElementById("userList");
  usersList.innerHTML = "";
  usersList.style.display = "flex";

  // Insert select-by-mutuals and select-by-following UI rows
  let selectRowsWrapper = document.getElementById('select-by-rows');
  if (!selectRowsWrapper) {
    selectRowsWrapper = document.createElement('div');
    selectRowsWrapper.id = 'select-by-rows';
    usersList.parentNode.insertBefore(selectRowsWrapper, usersList);
  }

  // Remove old rows if present (to avoid duplicates)
  const oldMutualsRow = document.getElementById('select-by-mutuals-row');
  if (oldMutualsRow) oldMutualsRow.remove();
  const oldFollowingRow = document.getElementById('select-by-following-row');
  if (oldFollowingRow) oldFollowingRow.remove();

  // Create and append select-by-mutuals-row
  let selectRow = document.createElement('div');
  selectRow.id = 'select-by-mutuals-row';
  selectRow.className = 'select-by-row';
  selectRow.innerHTML = `
    <button id="select-by-mutuals-btn" class="select-by-btn">Select</button>
    <span>everyone with more than</span>
    <input id="select-by-mutuals-input" type="number" min="0" max="999" maxlength="3" value="10">
    <span>mutuals</span>
  `;
  selectRowsWrapper.appendChild(selectRow);

  // Create and append select-by-following-row
  let selectFollowingRow = document.createElement('div');
  selectFollowingRow.id = 'select-by-following-row';
  selectFollowingRow.className = 'select-by-row';
  selectFollowingRow.innerHTML = `
    <button id="select-by-following-btn" class="select-by-btn">Select</button>
    <span>everyone you follow</span>
  `;
  selectRowsWrapper.appendChild(selectFollowingRow);

  const relationshipConfig = {
    "Follow Requests": {
      true: {
        true: { info: "You Follow Them", label: "Accept", action: "accept" },
        false: {
          info: "You Follow Them",
          label: "Accept",
          action: "accept",
        },
        undefined: { info: "You Follow Them", label: "Accept", action: "accept" },
      },
      false: {
        true: {
          info: "You Don't Follow Them",
          label: "Accept",
          action: "accept",
        },
        false: {
          info: "You Don't Follow Them",
          label: "Accept",
          action: "accept",
        },
        undefined: {
          info: "You Don't Follow Them",
          label: "Accept",
          action: "accept",
        },
      },
    },
  };
  if (users.length === 0) {
    usersList.innerHTML = "<div>No users to show.</div>";
    return;
  }
  users.forEach((user) => {
    const userDiv = document.createElement("div");
    userDiv.classList.add("user");
    userDiv.setAttribute("data-id", user.id);

    let relationState;

    if (user.is_pending_request) {
      // Special handling for follow requests
      const mutualInfo = user.mutual_count > 0 ? 
        `<div class="mutual-info">${user.mutual_count} mutual${user.mutual_count > 1 ? 's' : ''}</div>` :
        `<div class="mutual-info">Unknown mutuals</div>`;
      
      relationState = {
        info: user.followed_by_viewer ? "You Follow Them" : "",
        label: "Accept",
        action: "accept",
        mutualInfo: mutualInfo
      };
    } else if (user.requested_by_viewer) {
      relationState = {
        info: "Follow Request Sent",
        label: "Cancel Request",
        action: "unfollow", // ainda usaremos "unfollow" para cancelar
      };
    } else {
      relationState =
        relationshipConfig["Follow Requests"][!!user.followed_by_viewer][
          user.follows_viewer
        ];
    }
    const relationshipInfo = relationState.info
      ? `<div class='relationship-info'>${relationState.info}</div>`
      : "";
    const buttonLabel = relationState.label;
    const buttonAction = relationState.action;
    const mutualInfo = relationState.mutualInfo || '';

    userDiv.innerHTML = `
      <input type="checkbox" class="bulk-user-checkbox" value="${user.id}">
      <a href="https://www.instagram.com/${user.username}/" target="_blank">
        <img src="${user.profile_pic_url}" alt="${user.username}" class="user-photo">
      </a>
      <div class="user-details">
        <a href="https://www.instagram.com/${user.username}/" target="_blank" class="username">@${user.username}</a>
        <div class="full-name">${user.full_name}</div>
        ${relationshipInfo}
        ${mutualInfo}
      </div>
      <div class="action-buttons-container">
        ${user.is_pending_request ? 
          `<button class="action-button accept-button" data-id="${user.id}" data-action="accept">Accept</button>
           <button class="action-button reject-button" data-id="${user.id}" data-action="reject">Reject</button>` :
          `<button class="action-button" data-id="${user.id}" data-action="${buttonAction}">${buttonLabel}</button>`
        }
      </div>
    `;
    usersList.appendChild(userDiv);
  });

  // Bulk actions UI
  let bulkActionsDiv = document.getElementById('bulk-actions-container');
  if (!bulkActionsDiv) {
    bulkActionsDiv = document.createElement('div');
    bulkActionsDiv.id = 'bulk-actions-container';
    bulkActionsDiv.style.display = 'none';
    bulkActionsDiv.innerHTML = `
      <button id="bulk-accept-btn" class="bulk-action-btn accept">Accept (<span id="bulk-accept-count">0</span>)</button>
      <button id="bulk-reject-btn" class="bulk-action-btn reject">Reject (<span id="bulk-reject-count">0</span>)</button>
    `;
    usersList.parentNode.appendChild(bulkActionsDiv);
  }

  function updateBulkActionsUI() {
    const count = selectedUserIds.size;
    document.getElementById('bulk-accept-count').textContent = count;
    document.getElementById('bulk-reject-count').textContent = count;
    bulkActionsDiv.style.display = count > 0 ? 'flex' : 'none';
  }

  usersList.querySelectorAll('.bulk-user-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', function() {
      if (this.checked) {
        selectedUserIds.add(this.value);
      } else {
        selectedUserIds.delete(this.value);
      }
      updateBulkActionsUI();
    });
  });

  // Helper for bulk accept/reject actions
  async function handleBulkAction(actionFn) {
    const container = document.getElementById('bulk-actions-container');
    container.classList.add('fading-out');
    let count = selectedUserIds.size;
    document.getElementById('bulk-accept-count').textContent = count;
    document.getElementById('bulk-reject-count').textContent = count;
    for (const userId of selectedUserIds) {
      await actionFn(userId);
      count--;
      document.getElementById('bulk-accept-count').textContent = count;
      document.getElementById('bulk-reject-count').textContent = count;
      await new Promise(res => setTimeout(res, 500));
    }
    setTimeout(() => {
      container.style.display = 'none';
      container.classList.remove('fading-out');
    }, 500);
    selectedUserIds.clear();
    fetchFollowRequests();
  }

  document.getElementById('bulk-accept-btn').onclick = () => handleBulkAction(acceptFollowRequest);
  document.getElementById('bulk-reject-btn').onclick = () => handleBulkAction(rejectFollowRequest);

  attachButtonListeners();

  // After rendering users and checkboxes:
  document.getElementById('select-by-mutuals-btn').onclick = () => {
    const minMutuals = parseInt(document.getElementById('select-by-mutuals-input').value, 10) || 0;
    usersList.querySelectorAll('.user').forEach(userDiv => {
      const userId = userDiv.getAttribute('data-id');
      const mutualInfoDiv = userDiv.querySelector('.mutual-info');
      let mutuals = 0;
      if (mutualInfoDiv) {
        const match = mutualInfoDiv.textContent.match(/(\d+)/);
        if (match) mutuals = parseInt(match[1], 10);
      }
      const checkbox = userDiv.querySelector('.bulk-user-checkbox');
      if (checkbox) {
        if (mutuals > minMutuals) {
          checkbox.checked = true;
          selectedUserIds.add(userId);
        } else {
          checkbox.checked = false;
          selectedUserIds.delete(userId);
        }
      }
    });
    if (typeof updateBulkActionsUI === 'function') updateBulkActionsUI();
  };

  document.getElementById('select-by-following-btn').onclick = () => {
    usersList.querySelectorAll('.user').forEach(userDiv => {
      const userId = userDiv.getAttribute('data-id');
      const checkbox = userDiv.querySelector('.bulk-user-checkbox');
      // Find the user object from the loadedUsers map
      const userObj = loadedUsers.get(userId);
      if (checkbox && userObj) {
        if (userObj.followed_by_viewer) {
          checkbox.checked = true;
          selectedUserIds.add(userId);
        } else {
          checkbox.checked = false;
          selectedUserIds.delete(userId);
        }
      }
    });
    if (typeof updateBulkActionsUI === 'function') updateBulkActionsUI();
  };
}

function attachButtonListeners() {
  const buttons = document.querySelectorAll(".action-button");
  
  buttons.forEach((button, index) => {
    // Remove any existing listeners
    button.removeEventListener("click", handleActionButtonClick);
    
    // Add new listener
    button.addEventListener("click", handleActionButtonClick);
  });
}

// Instagram API variables - only initialize when document.body is available
let viewerId = null;
let headers = {
  "Content-Type": "application/x-www-form-urlencoded",
  "X-Requested-With": "XMLHttpRequest",
  "X-Asbd-Id": "129477",
  "X-Ig-Www-Claim": sessionStorage.getItem("www-claim-v2") || "",
};

function initializeInstagramAPI() {
  if (!document.body) return false;
  
  const viewerIdMatch = document.body.innerHTML.match(/"viewerId":"(\w+)"/i);
  const appScopedIdentityMatch = document.body.innerHTML.match(
    /"appScopedIdentity":"(\w+)"/i
  );
  const csrfTokenMatch = document.body.innerHTML.match(
    /(?<="csrf_token":").+?(?=")/i
  );
  const appIdMatch = document.body.innerHTML.match(
    /(?<="X-IG-App-ID":").+?(?=")/i
  );
  const rolloutHashMatch = document.body.innerHTML.match(
    /(?<="rollout_hash":").+?(?=")/i
  );

  viewerId = viewerIdMatch ? viewerIdMatch[1] : null;
  viewerId = viewerId || (appScopedIdentityMatch ? appScopedIdentityMatch[1] : null);

  if (csrfTokenMatch) {
    headers["X-Csrftoken"] = csrfTokenMatch[0];
  }
  if (appIdMatch) {
    headers["X-Ig-App-Id"] = appIdMatch[0];
  }
  if (rolloutHashMatch) {
    headers["X-Instagram-Ajax"] = rolloutHashMatch[0];
  }
  
  return !!viewerId;
}

function isWithinLimit(actionType) {
  try {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const oneHourAgo = now - 3600000;


    followUnfollowAttempts[actionType] = followUnfollowAttempts[
      actionType
    ].filter((timestamp) => timestamp >= oneHourAgo);


    const attemptsLastMinute = followUnfollowAttempts[actionType].filter(
      (timestamp) => timestamp >= oneMinuteAgo
    ).length;
    const attemptsLastHour = followUnfollowAttempts[actionType].length;


    if (attemptsLastMinute >= 5) {
      alert(
        `You have reached the limit of ${actionType} actions per minute. Please wait.`
      );
      return false;
    } else if (attemptsLastHour >= 60) {
      alert(
        `You have reached the limit of ${actionType} actions per hour. Please wait.`
      );
      return false;
    }

    followUnfollowAttempts[actionType].push(now);
    return true;
  } catch (error) {
    console.error("Error in isWithinLimit:", error);
    return false;
  }
}

const handleActionButtonClick = async (event) => {
  
  const userId = event.target.getAttribute("data-id");
  const action = event.target.getAttribute("data-action");
  
  
  if (!userId || !action) {
    console.error("Missing userId or action:", { userId, action });
    return;
  }
  
  if (!isWithinLimit(action)) {
    return;
  }

  if (action === "follow") {
    console.log("Calling followUser");
    await followUser(userId, event.target);
  } else if (action === "unfollow") {
    console.log("Calling unfollowUser");
    await unfollowUser(userId, event.target);
  } else if (action === "accept") {
    console.log("Calling acceptFollowRequest for user:", userId);
    await acceptFollowRequest(userId, event.target);
  } else if (action === "reject") {
    console.log("Calling rejectFollowRequest for user:", userId);
    await rejectFollowRequest(userId, event.target);
  } else {
    console.error("Unknown action:", action);
  }
  
};

function updateRelationshipInfo(userId, newStatus) {
  const userDiv = document.querySelector(`div.user[data-id="${userId}"]`);
  if (!userDiv) return;

  const relationshipInfoDiv = userDiv.querySelector(".relationship-info");
  const userActionButton = userDiv.querySelector(".action-button");
  const user = loadedUsers.get(userId);
  if (!user) return;

  if (user.is_pending_request) {
    // For follow requests, we don't need to update relationship info after accepting
    return;
  }

  if (user.requested_by_viewer) {
    relationshipInfoDiv.innerHTML = "Follow Request Sent";
    userActionButton.textContent = "Cancel Request";
    userActionButton.setAttribute("data-action", "unfollow");
    return;
  }

  if (caller === "Followers") {
    if (newStatus === "follow") {
      relationshipInfoDiv.innerHTML = "Mutual";
      userActionButton.textContent = "Unfollow";
      userActionButton.setAttribute("data-action", "unfollow");
    } else if (newStatus === "unfollow") {
      relationshipInfoDiv.innerHTML = "You Don't Follow Back";
      userActionButton.textContent = "Follow Back";
      userActionButton.setAttribute("data-action", "follow");
    }
  }

  if (caller === "Following") {
    if (newStatus === "follow") {
      relationshipInfoDiv.innerHTML =
        user.followed_by_viewer && !user.follows_viewer
          ? "Not Following You Back"
          : "Mutual";
      userActionButton.textContent = "Unfollow";
      userActionButton.setAttribute("data-action", "unfollow");
    } else if (newStatus === "unfollow") {
      relationshipInfoDiv.innerHTML =
        !user.followed_by_viewer && user.follows_viewer
          ? "You Don't Follow Back"
          : "Not Following You Back";
      userActionButton.textContent = "Follow";
      userActionButton.setAttribute("data-action", "follow");
    }
  }
}

const followUser = async (userId, button) => {
  button.disabled = true;
  try {
    const response = await fetch(
      `https://i.instagram.com/api/v1/web/friendships/${userId}/follow/`,
      {
        method: "POST",
        headers: headers,
        credentials: "include",
        mode: "cors",
      }
    );
    if (response.ok) {
      console.log("User followed successfully.");
      button.setAttribute("data-action", "unfollow");
      const user = loadedUsers.get(userId);
      user.followed_by_viewer = true;
      user.requested_by_viewer = false;
      updateRelationshipInfo(userId, "follow");
    } else {
      alert(
        "Error trying to follow the user. This may be due to reaching the limit of 5 actions per minute or 60 actions per hour. Please wait a moment before trying again."
      );
    }
  } catch (error) {
    alert("Error trying to follow the user. Try again later.");
    console.error("Error in the request:", error);
  } finally {
    button.disabled = false;
  }
};

const unfollowUser = async (userId, button) => {
  button.disabled = true;
  try {
    const response = await fetch(
      `https://i.instagram.com/api/v1/web/friendships/${userId}/unfollow/`,
      {
        method: "POST",
        headers: headers,
        credentials: "include",
        mode: "cors",
      }
    );
    if (response.ok) {
      console.log("User unfollowed successfully.");
      button.setAttribute("data-action", "follow");
      const user = loadedUsers.get(userId);
      user.followed_by_viewer = false;
      user.requested_by_viewer = false;
      updateRelationshipInfo(userId, "unfollow");
    } else {
      alert(
        "Error trying to unfollow the user. This may be due to reaching the limit of 5 actions per minute or 60 actions per hour. Please wait a moment before trying again."
      );
    }
  } catch (error) {
    alert("Error trying to unfollow the user. Try again later.");
    console.error("Error in the request:", error);
  } finally {
    button.disabled = false;
  }
};

const acceptFollowRequest = async (userId, button) => {
  if (!isWithinLimit("accept")) {
    return;
  }
  
  if (button) {
    button.disabled = true;
  }
  
  try {
    const response = await fetch(
      `https://i.instagram.com/api/v1/web/friendships/${userId}/approve/`,
      {
        method: "POST",
        headers: headers,
        credentials: "include",
        mode: "cors",
      }
    );
    if (response.ok) {
      console.log("Follow request accepted successfully.");
      
      // Remove the user from the list since the request is now accepted
      loadedUsers.delete(userId);
      
      // Only try to remove from UI if button is in the extension UI
      if (button && button.closest('.user')) {
        button.closest('.user').remove();
        
        // Update the count display
        const remainingUsers = [...loadedUsers.values()];
        if (remainingUsers.length === 0) {
          const userList = document.getElementById("userList");
          if (userList) {
            userList.innerHTML = "<div>No pending follow requests.</div>";
          }
        }
      }
      
      // Clear cache since we accepted a request
      clearCache();
    } else {
      alert("Error accepting follow request. Please try again later.");
    }
  } catch (error) {
    alert("Error accepting follow request. Please try again later.");
    console.error("Error in the request:", error);
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
};

const rejectFollowRequest = async (userId, button) => {
  if (!isWithinLimit("reject")) {
    return;
  }
  
  if (button) {
    button.disabled = true;
  }
  
  try {
    const response = await fetch(
      `https://i.instagram.com/api/v1/web/friendships/${userId}/ignore/`,
      {
        method: "POST",
        headers: headers,
        credentials: "include",
        mode: "cors",
      }
    );
    if (response.ok) {
      console.log("Follow request rejected successfully.");
      
      // Remove the user from the list since the request is now rejected
      loadedUsers.delete(userId);
      
      // Only try to remove from UI if button is in the extension UI
      if (button && button.closest('.user')) {
        button.closest('.user').remove();
        
        // Update the count display
        const remainingUsers = [...loadedUsers.values()];
        if (remainingUsers.length === 0) {
          const userList = document.getElementById("userList");
          if (userList) {
            userList.innerHTML = "<div>No pending follow requests.</div>";
          }
        }
      }
      
      // Clear cache since we rejected a request
      clearCache();
    } else {
      alert("Error rejecting follow request. Please try again later.");
    }
  } catch (error) {
    alert("Error rejecting follow request. Please try again later.");
    console.error("Error in the request:", error);
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
};

initializeExtension();
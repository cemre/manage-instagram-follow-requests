// Content script for profile banner functionality - Safari Version
// This runs on all Instagram pages automatically

// Global variables for profile banner
let isBannerInitialized = false;
let profileBanner = null;

// Instagram API variables
let viewerId = null;
let headers = {
  "Content-Type": "application/x-www-form-urlencoded",
  "X-Requested-With": "XMLHttpRequest",
  "X-Asbd-Id": "129477",
  "X-Ig-Www-Claim": sessionStorage.getItem("www-claim-v2") || "",
};

// Cache for pending follow requests
let pendingRequestsCache = {
  users: [],
  timestamp: null,
  cacheDuration: 5 * 60 * 1000 // 5 minutes in milliseconds
};

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

// Safari handles CSS injection automatically via Info.plist
// No need for injectCSSIfNeeded function

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

// Profile banner functionality
function createProfileBanner() {
  if (profileBanner) {
    profileBanner.remove();
  }
  
  profileBanner = document.createElement('div');
  profileBanner.id = 'ig-follow-request-banner';
  
  // Insert as last child of body
  document.body.appendChild(profileBanner);
  
  return profileBanner;
}

async function showProfileBanner(username, fullName, profilePicUrl, userId) {
  // Robustly check if the banner is actually in the DOM
  if (profileBanner) {
    if (!profileBanner.parentNode || !document.body.contains(profileBanner)) {
      profileBanner = null;
    } else {
      console.log('Banner already exists, not creating another one');
      return;
    }
  }
  
  console.log('Creating new banner for:', username);
  const banner = createProfileBanner();
  
  // Check if there's a next request before showing the checkbox
  const pendingUsers = await fetchPendingRequests(true);
  const currentIndex = pendingUsers.findIndex(user => user.node.id === userId);
  const hasNextRequest = currentIndex !== -1 && currentIndex < pendingUsers.length - 1;
  
  banner.innerHTML = `
    <div class="ig-banner-user-details">
        <b>@${username}</b>
        <span class="ig-banner-pos">(${currentIndex + 1}/${pendingUsers.length})</span>

    </div>
    <div class="ig-banner-buttons">
      <button id="accept-request-btn" class="ig-banner-accept-btn">Accept</button>
      <button id="reject-request-btn" class="ig-banner-reject-btn">Reject</button>
        ${hasNextRequest ? `
          <button id="advance-next-toggle" class="ig-banner-toggle-btn" data-enabled="true">
            Auto Next
          </button>
        ` : ''}   
    </div>
  `;
  
  document.body.appendChild(banner);
  profileBanner = banner;
  
  const acceptBtn = document.getElementById('accept-request-btn');
  const rejectBtn = document.getElementById('reject-request-btn');
  const buttonsDiv = banner.querySelector('.ig-banner-buttons');
  const toggleBtn = document.getElementById('advance-next-toggle');

  // Only set up toggle button if it exists (i.e., if there's a next request)
  if (toggleBtn) {
    // Load toggle state from session storage
    const savedToggleState = sessionStorage.getItem('ig-advance-next-toggle');
    if (savedToggleState !== null) {
      const isEnabled = savedToggleState === 'true';
      toggleBtn.setAttribute('data-enabled', isEnabled.toString());
      toggleBtn.classList.toggle('enabled', isEnabled);
    } else {
      // Default to enabled
      toggleBtn.classList.add('enabled');
    }

    // Toggle button click handler
    toggleBtn.addEventListener('click', () => {
      const currentState = toggleBtn.getAttribute('data-enabled') === 'true';
      const newState = !currentState;
      toggleBtn.setAttribute('data-enabled', newState.toString());
      toggleBtn.classList.toggle('enabled', newState);
      sessionStorage.setItem('ig-advance-next-toggle', newState.toString());
    });
  }

  // Function to navigate to a specific user by ID (new method)
  async function navigateToNextRequestById(nextUserId) {
    try {
      const pendingUsers = await fetchPendingRequests(true);
      const nextUser = pendingUsers.find(user => user.node.id === nextUserId);
      
      if (nextUser) {
        console.log('Navigating to next request by ID:', nextUser.node.username);
        
        // Navigate to the next user's profile
        window.location.href = `https://www.instagram.com/${nextUser.node.username}/`;
      } else {
        console.log('Next user not found in pending requests, navigation cancelled');
      }
    } catch (error) {
      console.error('Error navigating to next request by ID:', error);
    }
  }

  function showStatus(status) {
    // Update the button text instead of removing buttons
    if (status === 'Accepted') {
      acceptBtn.textContent = 'Accepted!';
      acceptBtn.classList.add('success');
      rejectBtn.classList.add('faded');
    } else {
      rejectBtn.textContent = 'Rejected!';
      rejectBtn.classList.add('success');
      acceptBtn.classList.add('faded');
    }
  }

  // Helper to handle accept/reject actions
  function handleRequest(actionFn, button, otherButton, statusText) {
    return async () => {
      button.disabled = true;
      otherButton.disabled = true;
      // Also disable toggle button immediately if it exists
      if (toggleBtn) {
        toggleBtn.disabled = true;
        toggleBtn.setAttribute('data-enabled', 'false');
        toggleBtn.classList.add('faded');
      }
      try {
        // Determine next user before processing the request
        let nextUserId = null;
        if (toggleBtn && toggleBtn.getAttribute('data-enabled') === 'true') {
          const currentIndex = pendingUsers.findIndex(user => user.node.id === userId);
          if (currentIndex !== -1 && currentIndex < pendingUsers.length - 1) {
            nextUserId = pendingUsers[currentIndex + 1].node.id;
            console.log('Next user ID determined before', statusText.toLowerCase(), ':', nextUserId);
          }
        }

        await actionFn(userId, button);
        showStatus(statusText);
        clearCache();
        profileBanner = banner;

        // Navigate to next request if we determined a next user
        if (nextUserId) {
          navigateToNextRequestById(nextUserId);
        }
      } catch (error) {
        console.error(`Error ${statusText.toLowerCase()} request:`, error);
        button.disabled = false;
        otherButton.disabled = false;
        // Re-enable toggle button on error
        if (toggleBtn) {
          toggleBtn.disabled = false;
        }
      }
    };
  }

  acceptBtn.addEventListener('click', handleRequest(acceptFollowRequest, acceptBtn, rejectBtn, 'Accepted'));
  rejectBtn.addEventListener('click', handleRequest(rejectFollowRequest, rejectBtn, acceptBtn, 'Rejected'));

  // Note: No dismiss button in current banner design
  // Users can dismiss by navigating away or refreshing the page
}

function hideProfileBanner() {
  if (profileBanner) {
    console.log('Hiding profile banner');
    profileBanner.remove();
    profileBanner = null;
  }
}

function isProfilePage() {
  const path = window.location.pathname;
  // Check if we're on a profile page (e.g., /username/)
  return /^\/[^\/]+\/?$/.test(path) && !path.includes('/p/') && !path.includes('/reel/');
}

function getCurrentProfileUsername() {
  const path = window.location.pathname;
  const match = path.match(/^\/([^\/]+)\/?$/);
  return match ? match[1] : null;
}

async function checkProfileForPendingRequest() {
  console.log('Checking profile for pending request...');
  
  if (!isProfilePage()) {
    console.log('Not a profile page, hiding banner');
    hideProfileBanner();
    return;
  }
  
  const username = getCurrentProfileUsername();
  if (!username) {
    console.log('No username found, hiding banner');
    hideProfileBanner();
    return;
  }
  
  console.log('Checking for pending request from:', username);
  
  try {
    const pendingUsers = await fetchPendingRequests(true); // Use cache by default
    console.log('Found', pendingUsers.length, 'pending users');
    
    const pendingUserIndex = pendingUsers.findIndex(user => 
      user.node.username.toLowerCase() === username.toLowerCase()
    );
    
    if (pendingUserIndex !== -1) {
      const pendingUser = pendingUsers[pendingUserIndex];
      console.log(`Found pending request at position ${pendingUserIndex + 1} of ${pendingUsers.length}, showing banner`);
      await showProfileBanner(
        pendingUser.node.username,
        pendingUser.node.full_name,
        pendingUser.node.profile_pic_url,
        pendingUser.node.id
      );
    } else {
      // Hide banner if we don't have a pending request (regardless of page type)
      console.log('No pending request found, hiding banner');
      hideProfileBanner();
    }
  } catch (error) {
    console.error('Error checking profile for pending request:', error);
    // Don't hide banner on error, just log it
  }
}

// Follow request functions
const acceptFollowRequest = async (userId, button) => {
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
      
      // Don't update cache here - let navigateToNextRequest handle it
      // This ensures the user is still in the cache for navigation
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
      
      // Don't update cache here - let navigateToNextRequest handle it
      // This ensures the user is still in the cache for navigation
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

// Initialize profile banner functionality
function initializeProfileBannerOnly() {
  console.log('initializeProfileBannerOnly called');
  
  // Prevent multiple initializations
  if (isBannerInitialized) {
    console.log('Banner already initialized, skipping');
    return;
  }
  
  // Initialize Instagram API
  if (!initializeInstagramAPI()) {
    console.log('Instagram API not ready, retrying in 2000ms...');
    setTimeout(initializeProfileBannerOnly, 2000);
    return;
  }
  
  console.log('Banner initialization complete');
  isBannerInitialized = true;
  
  // Check for profile banner if we're on a profile page
  if (isProfilePage()) {
    console.log('On profile page, checking for pending request');
    checkProfileForPendingRequest();
  } else {
    console.log('Not on profile page');
  }
}

// Initialize profile banner functionality on all Instagram pages
function initializeProfileBannerWithCSS() {
  // Check if already initialized
  if (isBannerInitialized) {
    console.log('Profile banner already initialized, skipping');
    return;
  }
  
  // Safari handles CSS injection automatically via Info.plist
  initializeProfileBannerOnly();
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeProfileBannerWithCSS);
} else {
  setTimeout(initializeProfileBannerWithCSS, 1000);
}

// SPA navigation detection for Instagram profile pages (polling method)
let lastProfilePath = null;

setInterval(() => {
  const currentPath = window.location.pathname;
  if (currentPath !== lastProfilePath) {
    console.log(`URL changed from ${lastProfilePath} to ${currentPath}`);
    lastProfilePath = currentPath;
    setTimeout(() => {
      console.log('Running checkProfileForPendingRequest after URL change');
      checkProfileForPendingRequest();
    }, 3000); // Wait 3 seconds for DOM to update
  }
}, 500); // Check every 500ms

// Also run on initial load
if (isProfilePage()) {
  lastProfilePath = window.location.pathname;
  setTimeout(() => {
    checkProfileForPendingRequest();
  }, 3000);
} 
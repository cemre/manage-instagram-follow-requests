const init = () => {
  let targetElement = document.getElementById("splash-screen");
  if (!targetElement) {
    targetElement = document.createElement("div");
    targetElement.id = "splash-screen";
    document.body.insertBefore(targetElement, document.body.firstChild);
  }

  var componentHtml = `
  <div class="overlay" id="overlay">
    <div class="my-component centered-column">
      <h2>Manage Follow Requests</h2>

      <p id="info-text">
        Easily manage your follow requests.
      </p>

      <div class="input-group" id="searchGroup">
        <input type="text" placeholder="🔍 Search by username or name..." id="searchInput" aria-label="Search users" />
      </div>

      <div id="titleAndFilter">
        <h3 id="title"></h3>
      </div>

      <div class="user-list" id="userList"></div>

      <div class="loader" id="loader"></div>
    </div>
  </div>
`;

  targetElement.insertAdjacentHTML("beforebegin", componentHtml);
};

init();

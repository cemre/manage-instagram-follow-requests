chrome.action.onClicked.addListener(async function () {
  chrome.scripting.executeScript({
    target: {tabId: (await chrome.tabs.query({active: true, currentWindow: true}))[0].id},
    func: () => {
      alert('To use this extension, visit a profile that requested to follow you');
    }
  });
});
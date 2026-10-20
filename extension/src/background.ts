/** Clicking the toolbar icon opens the side panel. The choice is persisted by Chrome. */
async function openPanelOnClick() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

chrome.runtime.onInstalled.addListener(() => { void openPanelOnClick(); });
void openPanelOnClick();

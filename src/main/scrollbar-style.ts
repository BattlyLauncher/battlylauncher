/** Shared styling for standalone Electron documents and downloaded overlays. */
export const scrollbarStyle = `
:root {
  color-scheme: dark;
}
* {
  scrollbar-width: thin !important;
  scrollbar-color: var(--scrollbar-thumb, #53677f) transparent !important;
}
*::-webkit-scrollbar {
  width: 8px !important;
  height: 8px !important;
  background: transparent !important;
}
*::-webkit-scrollbar-track,
*::-webkit-scrollbar-corner {
  background: transparent !important;
}
*::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb, #53677f) !important;
  border: 2px solid transparent;
  border-radius: 20px;
  background-clip: padding-box;
}
*::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-hover, #8196b0) !important;
}
*::-webkit-scrollbar-button {
  display: none !important;
  width: 0;
  height: 0;
}
@media (forced-colors: active) {
  * {
    scrollbar-color: auto !important;
  }
}
`;

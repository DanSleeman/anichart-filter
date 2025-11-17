// ==UserScript==
// @name         AniChart Filter
// @version      2.0
// @description  Filter AniChart cards based on the color of the highlight
// @author       David Gouveia
// @author       Dan Sleeman
// @match        https://anichart.net/*
// @grant        none
// ==/UserScript==

(function() {
  "use strict";

  const STORAGE_KEY = "anichart-selected-filters";
  const SELECTED_COLORS = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
  const REFRESH_DEBOUNCE_MS = 180;
  const KNOWN_COLORS = ["green", "yellow", "red", "gray"];
  const COLOR_RE = /--color-([a-z]+)/i;

  let refreshTimer = null;
  let mainObserver = null;


  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...SELECTED_COLORS]));
  }

  function debounceRefresh() {
    // debounce refresh so many rapid DOM mutations don't hammer the function
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refresh();
      refreshTimer = null;
    }, REFRESH_DEBOUNCE_MS);
  }

  function initializeCss() {
    if (document.getElementById("anichart-filter-css")) return;
    const css = document.createElement("style");
    css.id = "anichart-filter-css";
    css.textContent = `
      .anichart-filter-html {
        display: inline-block;
        height: 25px;
        vertical-align: middle;
      }
      .anichart-filter-checkbox {
        width: 25px;
        height: 25px;
        display: inline-block;
        position: relative;
        cursor: pointer;
        user-select: none;
        margin-right: 6px;
      }
      .anichart-filter-checkbox input {
        position: absolute;
        opacity: 0;
        cursor: pointer;
        height: 0;
        width: 0;
      }
      .anichart-filter-checkmark {
        position: absolute;
        top: 0;
        left: 0;
        height: 25px;
        width: 25px;
        border-radius: 50%;
      }
      .anichart-filter-checkmark.green { background-color: #2e6017; }
      .anichart-filter-checkmark.yellow { background-color: #7b5f31; }
      .anichart-filter-checkmark.red { background-color: #742e3a; }
      .anichart-filter-checkmark.gray { background-color: #555e66; }
      .anichart-filter-checkbox input:checked ~ .anichart-filter-checkmark.green { background-color: #5DC12F; }
      .anichart-filter-checkbox input:checked ~ .anichart-filter-checkmark.red { background-color: #E85D75; }
      .anichart-filter-checkbox input:checked ~ .anichart-filter-checkmark.yellow { background-color: #F7BF63; }
      .anichart-filter-checkbox input:checked ~ .anichart-filter-checkmark.gray { background-color: #AABCCD; }
      .anichart-filter-checkmark:after {
        content: "";
        position: absolute;
        display: none;
        box-sizing: content-box;
      }
      .anichart-filter-checkbox input:checked ~ .anichart-filter-checkmark:after {
        display: block;
      }
      .anichart-filter-checkbox .anichart-filter-checkmark:after {
        left: 9px;
        top: 6px;
        width: 5px;
        height: 8px;
        border: solid #2B2D42;
        border-width: 0 2px 2px 0;
        transform: rotate(45deg);
      }
      .anichart-filter-card-aired {
        outline: 2px dashed green;
      }`;
    document.head.appendChild(css);
  }

  function initializeHtml() {
    // If already present, just ensure listeners and checked state are correct
    let root = document.getElementById("anichart-filter-html");
    if (!root) {
      const filters = document.getElementsByClassName("filters");
      if (filters.length === 0) return;
      root = document.createElement("div");
      root.id = "anichart-filter-html";
      root.className = "anichart-filter-html";
      root.innerHTML = KNOWN_COLORS.map(color =>
        `<label class="anichart-filter-checkbox"><input type="checkbox" value="${color}"><span class="anichart-filter-checkmark ${color}"></span></label>`
      ).join("");
      filters[0].insertBefore(root, filters[0].children[0] || null);
    }

    // Attach listeners and restore check state (idempotent)
    const inputs = root.getElementsByTagName("input");
    for (let input of inputs) {
      if (!input._anichart_listening) {
        input.addEventListener("change", onCheckboxClicked);
        input._anichart_listening = true;
      }
      input.checked = SELECTED_COLORS.has(input.value);
    };
  }

  function onCheckboxClicked(e) {
    const v = e.target.value;
    if (e.target.checked) SELECTED_COLORS.add(v);
    else SELECTED_COLORS.delete(v);
    saveState();
    debounceRefresh();
  }

  function refresh() {
    try {
      // Trigger event to trick lazy loading to show more cards. Needed when there are few cards shown to begin with.
      window.dispatchEvent(new Event("resize"));
      const cards = document.querySelectorAll('.media-card, .airing-card');
      if (!cards || cards.length === 0) return;

      const noFilters = SELECTED_COLORS.size === 0;

      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const episode = card.getElementsByClassName("episode")[0];
        if (episode && episode.textContent.includes("aired")) {
          card.classList.add("anichart-filter-card-aired");
        } else { // Sometimes the page loads with incorrect show data and currently airing shows have the "aired on" text in season pages.
          card.classList.remove("anichart-filter-card-aired");
        }

        const highlighter = card.getElementsByClassName("highlighter")[0];
        if (!highlighter) continue;

        const match = COLOR_RE.exec(highlighter.style.cssText);
        let colorInCard = match ? match[1] : null;
        let show = 
          noFilters ||
          (colorInCard && SELECTED_COLORS.has(colorInCard)) ||
          (!colorInCard && SELECTED_COLORS.has("gray"));
        card.style.display = show ? "" : "none";
      }
    }
    catch (err) {
      console.error("anichart refresh error:", err);
    }
  }

function setupObservers() {
  if (mainObserver) return;

  let pendingCardsChange = false;
  let pendingFiltersChange = false;

  mainObserver = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (pendingCardsChange && pendingFiltersChange) break;

      if (m.type === "childList") {
        const allNodes = [...m.addedNodes, ...m.removedNodes];

        for (const node of allNodes) {
          if (node.nodeType !== 1) continue;

          const cl = node.classList;

          if (cl?.contains("filters") || node.querySelector?.(".filters")) {
            pendingFiltersChange = true;
          }

          if (
            cl?.contains("media-card") ||
            cl?.contains("airing-card") ||
            node.matches?.(".media-card *, .airing-card *") ||
            node.querySelector?.(".media-card, .airing-card")
          ) {
            pendingCardsChange = true;
          }

          if (pendingCardsChange && pendingFiltersChange) break;
        }
      } 
      else if (m.type === "attributes") {
        const target = m.target;
        if (target.closest?.(".media-card, .airing-card")) {
          pendingCardsChange = true;
        }
      }
    }

    if (pendingFiltersChange) {
      pendingFiltersChange = false;
      initializeHtml(); // idempotent
    }

    if (pendingCardsChange) {
      pendingCardsChange = false;
      debounceRefresh();
    }
  });

  mainObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style"] // This is needed for the lazy loading on initial page load
  });
}

  function initialize() {
    initializeCss();
    initializeHtml();
    setupObservers();
    debounceRefresh();
  }

  initialize();
})();

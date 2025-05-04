/* global $, Audio */

/* ──────────────── 1. STATE ──────────────── */
let pages = []; // pages in the currently‑selected juzʾ
let idx = 0; // page that is shown right now
let currentHokmId = null; // uuid of the selected ḥukm
const audio = new Audio();

/* ──────────────── 2. BOOT ───────────────── */
$(async () => {
  await buildHokmDropdown();
  bindUiEvents();

  /* deep‑link handling → /view/{hokmId}/{juzaId} */
  const m = location.pathname.match(/^\/view\/([^/]+)\/([^/]+)/);
  if (m) {
    const [, hk, jz] = m;
    await selectHokm(hk, false); // false → don’t pushState again
    await selectJuz(jz, false);
  }

  /* honour “show audios” checkbox on first load */
  if (!$("#toggle-audios").prop("checked")) $("body").addClass("hide-audios");
});

/* ───────────── 3. DROPDOWNS ────────────── */
async function buildHokmDropdown() {
  const list = await $.getJSON("/api/hokm").catch(() => []);
  const $ul = $("#hokm-ul").empty();

  if (!list.length) {
    $ul.append('<li class="empty">No items</li>');
    return;
  }
  list.forEach((h) => $ul.append(`<li data-hokm="${h.id}">${h.name}</li>`));
}

function buildJuzDropdown(list) {
  const $ul = $("#juz-ul").empty();
  list.forEach((j) =>
    $ul.append(
      `<li data-id="${j.id}" data-num="${j.number}">
         Juz&#8239;${j.number}
       </li>`
    )
  );
  $("#juz-btn").prop("disabled", !list.length).find("p").text("Choose Juzʾ");
}

/* ───────────── 4. UI EVENTS ────────────── */
function bindUiEvents() {
  /* dropdown open / close */
  $(document).on("click", ".dropdown-btn", function (e) {
    e.stopPropagation();
    const $list = $(this).next(".dropdown-list");
    $(".dropdown-list").not($list).removeClass("show");
    $list.toggleClass("show");
    $(this).find("i").toggleClass("rotated", $list.hasClass("show"));
  });
  $(document).on("click", (e) => {
    if (!$(e.target).closest(".list-dropdown").length) closeDropdowns();
  });

  /* select ḥukm -------------------------------------------------------- */
  $("#hokm-ul").on("click", "li[data-hokm]", async function () {
    currentHokmId = $(this).data("hokm");
    const name = $(this).text();

    $("#hokm-btn p").text(name);
    $("#hokm-ul li").removeClass("selected");
    $(this).addClass("selected");
    closeDropdowns();

    $("#juz-btn").prop("disabled", true).find("p").text("Loading…");

    const juzList = await $.getJSON("/api/ajza/" + currentHokmId).catch(
      () => []
    );
    buildJuzDropdown(juzList);
    if (juzList.length) $("#juz-ul li").first().trigger("click");
  });

  /* select juzʾ -------------------------------------------------------- */
  $("#juz-ul").on("click", "li[data-id]", async function () {
    const juzaId = $(this).data("id");
    const juzaNum = $(this).data("num");

    $("#juz-btn p").text("Juzʾ " + juzaNum);
    closeDropdowns();

    /* copy‑and‑paste‑able URL */
    if (currentHokmId) {
      history.pushState(
        { hokmId: currentHokmId, juzaId },
        "",
        `/view/${currentHokmId}/${juzaId}`
      );
    }

    pages = await $.getJSON("/api/pages/" + juzaId).catch(() => []);
    pages.length ? loadImg(0) : $("#page-holder").hide();
  });

  /* show / hide hotspot outlines -------------------------------------- */
  $("#toggle-audios").on("change", function () {
    $("body").toggleClass("hide-audios", !this.checked);
  });

  /* navigation --------------------------------------------------------- */
  $("#prev").on("click", (e) => {
    e.preventDefault();
    if (idx) loadImg(idx - 1);
  });
  $("#next").on("click", (e) => {
    e.preventDefault();
    if (idx < pages.length - 1) loadImg(idx + 1);
  });
  $(document).on("keydown", (e) => {
    if (e.key === "ArrowLeft" && idx) loadImg(idx - 1);
    if (e.key === "ArrowRight" && idx < pages.length - 1) loadImg(idx + 1);
  });

  /* keep hotspots aligned on resize ----------------------------------- */
  $(window).on(
    "resize orientationchange",
    () => pages.length && renderHotspots()
  );

  /* Back / Forward buttons -------------------------------------------- */
  window.addEventListener("popstate", (ev) => {
    const st = ev.state;
    if (!st) return;
    selectHokm(st.hokmId, false).then(() => selectJuz(st.juzaId, false));
  });
}

/* ───────────── 5. HELPERS ─────────────── */
function closeDropdowns() {
  $(".dropdown-list").removeClass("show");
  $(".dropdown-btn i").removeClass("rotated");
}

function selectHokm(id, push = true) {
  if (id === currentHokmId) return Promise.resolve();
  return new Promise((res) => {
    $('#hokm-ul li[data-hokm="' + id + '"]')
      .one("click", res)
      .click();
    if (push) history.pushState({}, "", "/view/" + id);
  });
}

function selectJuz(id, push = true) {
  return new Promise((res) => {
    $('#juz-ul li[data-id="' + id + '"]')
      .one("click", res)
      .click();
    /* push handled in click handler when push is true */
  });
}

/* ───────────── 6. PAGE / HOTSPOTS ───────── */
function loadImg(i) {
  idx = i;
  $("#prev").toggleClass("disabled", idx === 0);
  $("#next").toggleClass("disabled", idx === pages.length - 1);

  $("#page-holder")
    .attr("src", pages[idx].image_url)
    .show()
    .off("load")
    .on("load", renderHotspots);
}

function renderHotspots() {
  $(".hot").remove();
  const page = pages[idx];
  if (!page) return;

  const img = $("#page-holder")[0];
  const natW = img.naturalWidth;
  const natH = img.naturalHeight;
  const dispW = $(img).width();
  const scale = dispW / natW;

  (page.hotspots || []).forEach((h) => {
    $('<span class="hot"/>')
      .css({
        left: h.x * dispW,
        top: h.y * natH * scale,
        width: h.w * dispW,
        height: h.h * natH * scale,
      })
      .appendTo(".image-displayer")
      .on("click", () => {
        if (h.audio) {
          audio.src = h.audio;
          audio.play();
        }
      });
  });
}

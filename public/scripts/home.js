/* global $, Audio */

let pages = [];
let idx = 0;
let currentHokmId = null;
const audio = new Audio();

$(async () => {
  await buildHokmDropdown();
  bindUiEvents();

  const m = location.pathname.match(/^\/view\/([^/]+)\/([^/]+)/);
  if (m) {
    const [, hk, jz] = m;
    await selectHokm(hk, {
      juzaId: jz,
      push: false,
      autoSelectFirst: false,
    });
  }

  if (!$("#toggle-audios").prop("checked")) $("body").addClass("hide-audios");
});

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
  $("#juz-btn").prop("disabled", !list.length).find("p").text("Choose JuzE_");
}

function bindUiEvents() {
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

  $("#hokm-ul").on("click", "li[data-hokm]", async function () {
    const hokmId = $(this).data("hokm");
    await selectHokm(hokmId, { push: true, autoSelectFirst: true });
  });

  $("#juz-ul").on("click", "li[data-id]", async function () {
    const juzaId = $(this).data("id");
    await selectJuz(juzaId, { push: true });
  });

  $("#toggle-audios").on("change", function () {
    $("body").toggleClass("hide-audios", !this.checked);
  });

  $(".prev").on("click", (e) => {
    e.preventDefault();
    if (idx) loadImg(idx - 1);
  });
  $(".next").on("click", (e) => {
    e.preventDefault();
    if (idx < pages.length - 1) loadImg(idx + 1);
  });
  $(document).on("keydown", (e) => {
    if (e.key === "ArrowLeft" && idx) loadImg(idx - 1);
    if (e.key === "ArrowRight" && idx < pages.length - 1) loadImg(idx + 1);
  });

  $(window).on(
    "resize orientationchange",
    () => pages.length && renderHotspots()
  );

  window.addEventListener("popstate", (ev) => {
    const st = ev.state;
    if (!st) return;
    selectHokm(st.hokmId, {
      juzaId: st.juzaId,
      push: false,
      autoSelectFirst: false,
    });
  });
}

function closeDropdowns() {
  $(".dropdown-list").removeClass("show");
  $(".dropdown-btn i").removeClass("rotated");
}

async function selectHokm(
  id,
  { juzaId = null, push = true, autoSelectFirst = true } = {}
) {
  if (id === currentHokmId && !juzaId) return;

  currentHokmId = id;
  pages = [];
  idx = 0;
  $("#page-holder").hide();

  const $item = $('#hokm-ul li[data-hokm="' + id + '"]');
  if ($item.length) {
    $("#hokm-btn p").text($item.text());
    $("#hokm-ul li").removeClass("selected");
    $item.addClass("selected");
  }
  closeDropdowns();

  $("#juz-btn").prop("disabled", true).find("p").text("Loading...");

  const juzList = await $.getJSON("/api/ajza/" + id).catch(() => []);
  buildJuzDropdown(juzList);

  if (!juzList.length) {
    $("#juz-btn").prop("disabled", true).find("p").text("No JuzE_");
    return;
  }

  const hasTarget = juzaId && juzList.some((j) => j.id === juzaId);
  const targetJuzaId = hasTarget
    ? juzaId
    : autoSelectFirst
    ? juzList[0].id
    : null;

  if (targetJuzaId) {
    await selectJuz(targetJuzaId, { push });
  }
}

async function selectJuz(id, { push = true } = {}) {
  const $li = $('#juz-ul li[data-id="' + id + '"]');
  if (!$li.length) return;

  const juzaNum = $li.data("num");
  $("#juz-ul li").removeClass("selected");
  $li.addClass("selected");
  $("#juz-btn p").text("Juz " + juzaNum);
  closeDropdowns();

  if (currentHokmId && push) {
    history.pushState(
      { hokmId: currentHokmId, juzaId: id },
      "",
      `/view/${currentHokmId}/${id}`
    );
  }

  pages = await $.getJSON("/api/pages/" + id).catch(() => []);
  pages.length ? loadImg(0) : $("#page-holder").hide();
}

function loadImg(i) {
  idx = i;
  $(".prev").toggleClass("disabled", idx === 0);
  $(".next").toggleClass("disabled", idx === pages.length - 1);

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

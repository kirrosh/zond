// Inline JS for the report. No external deps. Uses RegExp() with string args
// to dodge backslash-escaping headaches inside the TS template literal.

export const SCRIPT = `
(() => {
  // JSON highlighter: build regex from a string source.
  var src = '("(?:\\\\\\\\.|[^"\\\\\\\\])*")(\\\\s*:)?|\\\\b(true|false|null)\\\\b|-?\\\\d+(?:\\\\.\\\\d+)?(?:[eE][+-]?\\\\d+)?';
  var reJson = new RegExp(src, 'g');
  function highlight(str) {
    return str.replace(reJson, function (m, quoted, colon, kw) {
      if (quoted) {
        return colon
          ? '<span class="j-key">' + quoted + '</span>' + colon
          : '<span class="j-str">' + quoted + '</span>';
      }
      if (kw === 'true' || kw === 'false') return '<span class="j-bool">' + kw + '</span>';
      if (kw === 'null') return '<span class="j-null">null</span>';
      return '<span class="j-num">' + m + '</span>';
    });
  }
  document.querySelectorAll('pre.code[data-lang="json"]').forEach(function (el) {
    if (el.dataset.hl === '1') return;
    el.dataset.hl = '1';
    el.innerHTML = highlight(el.textContent || '');
  });

  // Card expand/collapse.
  document.querySelectorAll('.card .head').forEach(function (btn) {
    btn.addEventListener('click', function () {
      btn.closest('.card').classList.toggle('open');
    });
  });

  // Tabs (per card).
  document.querySelectorAll('.tabs').forEach(function (tabs) {
    tabs.querySelectorAll('button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = btn.dataset.tab;
        var card = btn.closest('.card');
        card.querySelectorAll('.tabs button').forEach(function (b) {
          b.classList.toggle('active', b === btn);
        });
        card.querySelectorAll('.panel').forEach(function (p) {
          p.classList.toggle('active', p.dataset.tab === target);
        });
      });
    });
  });

  function flash(btn, ok) {
    var orig = btn.dataset.label || btn.textContent;
    btn.dataset.label = orig;
    btn.textContent = ok ? '✓ Copied' : '✗ Failed';
    btn.classList.add('copied');
    setTimeout(function () {
      btn.textContent = orig;
      btn.classList.remove('copied');
    }, 1500);
  }
  function copyText(text, btn) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { flash(btn, true); },
        function () { fallbackCopy(text, btn); },
      );
    } else {
      fallbackCopy(text, btn);
    }
  }
  function fallbackCopy(text, btn) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); flash(btn, true); }
    catch (e) { flash(btn, false); }
    finally { document.body.removeChild(ta); }
  }
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var sel = btn.dataset.copy;
      var src = btn.closest('.card').querySelector('[data-payload="' + sel + '"]');
      var text = src ? (src.textContent || '') : '';
      copyText(text, btn);
    });
  });

  // Failure-class filter.
  var filterBtns = document.querySelectorAll('.filters [data-filter]');
  filterBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var f = btn.dataset.filter;
      filterBtns.forEach(function (b) { b.classList.toggle('active', b === btn); });
      document.querySelectorAll('.cards .card').forEach(function (c) {
        var fc = c.dataset.fclass || 'unclassified';
        c.classList.toggle('hidden', f !== 'all' && fc !== f);
      });
    });
  });
})();
`;

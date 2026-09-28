// UI enhancement functions for manuscript viewer
(function(){
  'use strict';

  // === Fullscreen ===
  window.toggleFullscreen = function() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(function(){});
    } else {
      document.exitFullscreen().catch(function(){});
    }
  };

  // === Panel Resizer ===
  var resizer = document.getElementById('panelResizer');
  var panel = document.getElementById('sidePanel');
  var isResizing = false;
  var startX, startWidth;

  if (resizer && panel) {
    resizer.addEventListener('mousedown', function(e) {
      isResizing = true;
      startX = e.clientX;
      startWidth = panel.offsetWidth;
      resizer.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', function(e) {
      if (!isResizing) return;
      var diff = startX - e.clientX;
      var newWidth = Math.max(200, Math.min(800, startWidth + diff));
      panel.style.width = newWidth + 'px';
      localStorage.setItem('coreader-panel-w', newWidth);
    });

    document.addEventListener('mouseup', function() {
      if (isResizing) {
        isResizing = false;
        resizer.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });

    // Restore saved width
    var saved = localStorage.getItem('coreader-panel-w');
    if (saved) panel.style.width = saved + 'px';
  }

  // === Text Selection Toggle ===
  var _textSelEnabled = true;
  window.toggleTextSelection = function(enabled) {
    _textSelEnabled = enabled;
    var textEl = document.getElementById('textContent');
    if (textEl) {
      textEl.style.userSelect = enabled ? 'text' : 'none';
      textEl.style.webkitUserSelect = enabled ? 'text' : 'none';
      textEl.style.cursor = enabled ? 'text' : 'default';
    }
    // Also affect ganjoor text if present
    var gText = document.getElementById('gTextContent');
    if (gText) {
      gText.style.userSelect = enabled ? 'text' : 'none';
      gText.style.cursor = enabled ? 'text' : 'default';
    }
  };

  // === Override applySetting to also update ganjoor text ===
  var _origApplySetting = window.applySetting;
  window.applySetting = function(key, val) {
    if (_origApplySetting) _origApplySetting(key, val);
    // Also apply to ganjoor text elements
    var textEl = document.getElementById('textContent');
    if (textEl) {
      if (key === 'font') textEl.style.fontFamily = val;
      if (key === 'fs') textEl.style.fontSize = val + 'px';
      if (key === 'lh') textEl.style.lineHeight = (val / 10).toFixed(1);
      if (key === 'fw') textEl.style.fontWeight = val;
      if (key === 'fgColor') textEl.style.color = val;
    }
  };

})();

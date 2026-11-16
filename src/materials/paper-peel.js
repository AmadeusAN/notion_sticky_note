/* Full-height paper curl. This is deliberately a classic script for file:// previews. */
(function (global) {
  "use strict";

  var COLUMNS = 88;
  var ROWS = 20;
  var SHADES = 128;
  var STRIDE = ROWS + 1;
  var VERTICES = (COLUMNS + 1) * STRIDE;

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function create(host, canvas) {
    var context = canvas.getContext("2d");
    if (!context) throw new Error("Paper peel requires a Canvas2D context.");

    // This detached one-pixel canvas resolves CSS colors only. No note pixels,
    // text, images, or other DOM content are ever sampled or copied.
    var colorCanvas = document.createElement("canvas");
    colorCanvas.width = colorCanvas.height = 1;
    var colorContext = colorCanvas.getContext("2d", { willReadFrequently: true });
    if (!colorContext) throw new Error("Paper peel requires CSS color resolution.");

    var x = new Float32Array(VERTICES);
    var y = new Float32Array(VERTICES);
    var rowAngles = new Float32Array(STRIDE);
    var rowLengths = new Float32Array(STRIDE);
    var hinges = new Float32Array(STRIDE);
    var lips = new Float32Array(STRIDE);
    var lipColumns = new Uint8Array(STRIDE);
    var front = new Array(SHADES);
    var back = new Array(SHADES);
    var width = 0;
    var height = 0;
    var dpr = 1;
    var radius = 0;
    var paper;
    var ink;
    var baseColor;
    var lineColor;
    var shadowColor;
    var edgeColor;
    var amount = 0;
    var target = 0;
    var pointer = 0.5;
    var targetPointer = 0.5;
    var frame = 0;
    var previousTime = 0;
    var destroyed = false;
    var observer = null;
    var resizeFrame = 0;
    var dprQuery = null;
    var palettePaper = null;
    var paletteInk = null;
    var paletteScheme = null;
    var paletteForeground = null;

    function resolveColor(value, fallback) {
      colorContext.clearRect(0, 0, 1, 1);
      colorContext.fillStyle = fallback;
      colorContext.fillStyle = value || fallback;
      colorContext.fillRect(0, 0, 1, 1);
      var pixel = colorContext.getImageData(0, 0, 1, 1).data;
      return [pixel[0], pixel[1], pixel[2]];
    }

    function rgb(red, green, blue) {
      return "rgb(" + Math.round(clamp(red, 0, 255)) + "," +
        Math.round(clamp(green, 0, 255)) + "," +
        Math.round(clamp(blue, 0, 255)) + ")";
    }

    function tint(color, light) {
      // A warm underside remains opaque paper, not translucent glass or a
      // black gradient. Light is deliberately restrained on yellow themes.
      if (light >= 0) {
        return rgb(color[0] + (255 - color[0]) * light,
          color[1] + (255 - color[1]) * light,
          color[2] + (250 - color[2]) * light);
      }
      return rgb(color[0] * (1 + light), color[1] * (1 + light), color[2] * (1 + light));
    }

    function clear() {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function outline() {
      context.beginPath();
      context.roundRect(0, 0, width, height, radius);
    }

    function cellPath(column, row) {
      var a = column * STRIDE + row;
      var b = a + STRIDE;
      context.beginPath();
      context.moveTo(x[a], y[a]);
      context.lineTo(x[a + 1], y[a + 1]);
      context.lineTo(x[b + 1], y[b + 1]);
      context.lineTo(x[b], y[b]);
      context.closePath();
    }

    function draw() {
      clear();
      if (amount <= 0 || width < 2 || height < 2) return;

      var eased = amount * amount * (3 - 2 * amount);
      // Each horizontal material line follows a cylindrical arc, but arc
      // length and angle vary continuously down the sheet. The resulting
      // bowed, twisted surface has a visibly curved spine and free edge;
      // it cannot collapse into the silhouette of a straight gradient bar.
      // Even the top/bottom lines bend, rather than hinging at one corner.
      var length = width * (0.035 + 0.415 * eased) * amount;
      var angle = 0.12 + eased * 2.64;
      var depth = Math.max(width, height) * 5.5;
      var viewSlope = 0.105;
      var middle = height * (0.5 + (pointer - 0.5) * 0.10);
      var inset = Math.min(1.5, height * 0.003) * amount;
      var edgeStart = COLUMNS * STRIDE;
      var hinge = width;

      for (var row = 0; row <= ROWS; row++) {
        var v = row / ROWS;
        var bow = Math.sin(v * Math.PI);
        var diagonal = (v - 0.5) * (pointer - 0.5);
        // The middle of the page bows farther inward than its ends. The
        // pointer supplies a gentle diagonal pull on this full-height bow.
        rowLengths[row] = length * (1 + eased * (-0.27 + 0.35 * bow + diagonal * 0.70));
        rowAngles[row] = angle * (1 + eased * (-0.09 + 0.14 * bow + diagonal * 0.26));
        hinges[row] = width - rowLengths[row];
        hinge = Math.min(hinge, hinges[row]);
        lips[row] = hinges[row];
        lipColumns[row] = 0;
      }

      // Projection operates on reusable vertex buffers. Perspective opens
      // a small gap along the upper/lower boundaries, showing that this is
      // suspended paper, while retaining almost the whole lifted edge.
      for (var column = 0; column <= COLUMNS; column++) {
        var u = column / COLUMNS;
        for (var surfaceRow = 0; surfaceRow <= ROWS; surfaceRow++) {
          var ny = surfaceRow / ROWS;
          var theta = rowAngles[surfaceRow] * u;
          var cylinderRadius = rowLengths[surfaceRow] / rowAngles[surfaceRow];
          var z = cylinderRadius * (1 - Math.cos(theta));
          var projectedX = cylinderRadius * Math.sin(theta) - z * viewSlope;
          var perspective = depth / (depth + z);
          var vertex = column * STRIDE + surfaceRow;
          x[vertex] = hinges[surfaceRow] + projectedX * perspective;
          y[vertex] = middle + (inset + ny * (height - 2 * inset) - middle) * perspective +
            z * (pointer - 0.5) * 0.055;
          if (x[vertex] > lips[surfaceRow]) {
            lips[surfaceRow] = x[vertex];
            lipColumns[surfaceRow] = column;
          }
        }
      }

      context.save();
      outline();
      context.clip();

      // The stationary sheet underneath extends to the ORIGINAL boundary.
      // Its visible width is the actual opening between the moving free edge
      // and that boundary; it is not a painted, constant-width edge stripe.
      context.beginPath();
      context.moveTo(width, 0);
      context.lineTo(width, height);
      context.lineTo(x[edgeStart + ROWS], height);
      for (var underRow = ROWS; underRow >= 0; underRow--) {
        context.lineTo(x[edgeStart + underRow], y[edgeStart + underRow]);
      }
      context.lineTo(x[edgeStart], 0);
      context.closePath();
      context.fillStyle = baseColor;
      context.fill();
      context.save();
      context.clip();
      context.strokeStyle = lineColor;
      context.lineWidth = 0.65;
      context.beginPath();
      for (var lineY = 9; lineY < height; lineY += 9) {
        context.moveTo(hinge, lineY);
        context.lineTo(width, lineY);
      }
      context.stroke();

      // Cast shadow follows the CURVED projected spine, not a rectangular
      // linear-gradient stripe. A small reusable mesh supplies a soft falloff
      // without blur filters or a new gradient allocation for every row.
      context.fillStyle = shadowColor;
      var shadowBands = 28;
      for (var band = 0; band < shadowBands; band++) {
        var near = band / shadowBands;
        var far = (band + 1) / shadowBands;
        context.globalAlpha = amount * (0.12 + eased * 0.12) * Math.pow(1 - near, 2);
        context.beginPath();
        for (var shadowRow = 0; shadowRow <= ROWS; shadowRow++) {
          var spread = rowLengths[shadowRow] * (0.10 + eased * 0.34);
          var sx = lips[shadowRow] + (near - 0.06) * spread;
          if (shadowRow === 0) context.moveTo(sx, 0);
          else context.lineTo(sx, shadowRow / ROWS * height);
        }
        for (var shadowBack = ROWS; shadowBack >= 0; shadowBack--) {
          var outerSpread = rowLengths[shadowBack] * (0.10 + eased * 0.34);
          context.lineTo(lips[shadowBack] + (far - 0.06) * outerSpread,
            shadowBack / ROWS * height);
        }
        context.closePath();
        context.fill();
      }
      context.restore();

      // A narrow contact shadow follows the bowed hinge on the stationary
      // front. Its distinct footprint helps separate the two paper surfaces.
      context.fillStyle = shadowColor;
      var contactWidth = Math.max(1, Math.min(13, length * 0.10));
      for (var contactBand = 0; contactBand < 12; contactBand++) {
        var contactNear = contactBand / 12;
        var contactFar = (contactBand + 1) / 12;
        context.globalAlpha = amount * 0.12 * (1 - contactNear) * (1 - contactNear);
        context.beginPath();
        for (var contactRow = 0; contactRow <= ROWS; contactRow++) {
          var cx = hinges[contactRow] - contactNear * contactWidth;
          if (contactRow === 0) context.moveTo(cx, 0);
          else context.lineTo(cx, contactRow / ROWS * height);
        }
        for (var contactBack = ROWS; contactBack >= 0; contactBack--) {
          context.lineTo(hinges[contactBack] - contactFar * contactWidth,
            contactBack / ROWS * height);
        }
        context.closePath();
        context.fill();
      }
      context.globalAlpha = 1;

      // Draw in material order: the turned-over back is nearer the camera
      // and occludes the front. The dot-product lighting darkens the curved
      // spine, with a narrow soft highlight where it rolls toward the light.
      // Colors are precomputed on refresh, not allocated inside this loop.
      context.lineWidth = 0.65;
      context.lineJoin = "round";
      for (var strip = 0; strip < COLUMNS; strip++) {
        for (var shadeRow = 0; shadeRow < ROWS; shadeRow++) {
          var normal = (rowAngles[shadeRow] + rowAngles[shadeRow + 1]) *
            0.5 * (strip + 0.5) / COLUMNS;
          var isBack = normal > Math.PI * 0.5;
          var illumination;
          if (isBack) {
            illumination = 0.34 - 0.60 * Math.cos(normal);
          } else {
            illumination = 0.80 + 0.19 * Math.cos(normal + 0.55) -
              0.35 * Math.pow(Math.sin(normal), 4);
          }
          var shade = Math.round(clamp(illumination, 0, 1) * (SHADES - 1));
          context.fillStyle = isBack ? back[shade] : front[shade];
          context.strokeStyle = context.fillStyle;
          cellPath(strip, shadeRow);
          context.fill();
          // Subpixel overlap closes seams; cells contain no allocated data.
          context.stroke();
        }
      }

      // Faint ruled texture follows the actual projected paper, not a flat
      // pattern laid over the curl. It intentionally contains no note content.
      context.save();
      context.strokeStyle = lineColor;
      context.lineWidth = 0.6;
      context.beginPath();
      // Draw only the visible branch at each point (the turned back covers
      // the front). Sampling vertices avoids arrays/objects inside the loop.
      for (var textureY = 9; textureY < height - 2; textureY += 9) {
        var rowPosition = clamp(textureY / height * ROWS, 0, ROWS - 0.0001);
        var lowRow = Math.floor(rowPosition);
        var blend = rowPosition - lowRow;
        var textureStart = Math.round(lipColumns[lowRow] +
          (lipColumns[lowRow + 1] - lipColumns[lowRow]) * blend);
        if (textureStart === COLUMNS) textureStart = 0;
        for (var textureColumn = textureStart; textureColumn <= COLUMNS; textureColumn++) {
          var index = textureColumn * STRIDE + lowRow;
          var tx = x[index] + (x[index + 1] - x[index]) * blend;
          var ty = y[index] + (y[index + 1] - y[index]) * blend;
          if (textureColumn === textureStart) context.moveTo(tx, ty);
          else context.lineTo(tx, ty);
        }
      }
      context.stroke();
      context.restore();

      // The free edge has paper thickness (one subdued hairline), not a
      // plastic bevel. Its whole curved height remains visible during lift.
      context.beginPath();
      context.moveTo(x[edgeStart], y[edgeStart]);
      for (var edgeRow = 1; edgeRow <= ROWS; edgeRow++) {
        context.lineTo(x[edgeStart + edgeRow], y[edgeStart + edgeRow]);
      }
      context.strokeStyle = edgeColor;
      context.lineWidth = 0.8;
      context.stroke();
      context.restore();
    }

    function tick(time) {
      frame = 0;
      if (destroyed) return;
      var dt = previousTime ? Math.min(48, time - previousTime) : 16.67;
      previousTime = time;
      amount += (target - amount) * (1 - Math.exp(-dt / 95));
      pointer += (targetPointer - pointer) * (1 - Math.exp(-dt / 140));
      var settled = Math.abs(target - amount) < 0.0007 &&
        Math.abs(targetPointer - pointer) < 0.0007;
      if (settled) {
        amount = target;
        pointer = targetPointer;
      }
      draw();
      if (!settled) frame = global.requestAnimationFrame(tick);
      else previousTime = 0;
    }

    function setTarget(nextAmount, nextPointer) {
      if (destroyed) return;
      target = Number.isFinite(nextAmount) ? clamp(nextAmount, 0, 1) : 0;
      targetPointer = Number.isFinite(nextPointer) ? clamp(nextPointer, 0, 1) : 0.5;
      if (amount === 0 && target === 0) {
        pointer = targetPointer;
        return;
      }
      if (!frame && (amount !== target || pointer !== targetPointer)) {
        previousTime = 0;
        frame = global.requestAnimationFrame(tick);
      }
    }

    function refresh() {
      if (destroyed) return;
      var style = global.getComputedStyle(host);
      var nextWidth = host.clientWidth;
      var nextHeight = host.clientHeight;
      var nextDpr = clamp(global.devicePixelRatio || 1, 1, 2);
      var nextRadius = clamp(parseFloat(style.borderTopRightRadius) || 0, 0, Math.min(nextWidth, nextHeight) / 2);
      var nextPaper = style.getPropertyValue("--note-bg").trim() || style.getPropertyValue("--paper").trim();
      var nextInk = style.getPropertyValue("--note-fg").trim() || style.getPropertyValue("--paper-ink").trim();
      var paletteChanged = nextPaper !== palettePaper || nextInk !== paletteInk ||
        style.colorScheme !== paletteScheme || style.color !== paletteForeground;
      var geometryChanged = width !== nextWidth || height !== nextHeight || dpr !== nextDpr || radius !== nextRadius;
      if (!paletteChanged && !geometryChanged) return;
      width = nextWidth;
      height = nextHeight;
      dpr = nextDpr;
      radius = nextRadius;
      var bitmapWidth = Math.max(1, Math.round(width * dpr));
      var bitmapHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== bitmapWidth) canvas.width = bitmapWidth;
      if (canvas.height !== bitmapHeight) canvas.height = bitmapHeight;
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      if (paletteChanged) {
        palettePaper = nextPaper;
        paletteInk = nextInk;
        paletteScheme = style.colorScheme;
        paletteForeground = style.color;
        paper = resolveColor(nextPaper, "#fff4a3");
        ink = resolveColor(nextInk, "#51452c");
        baseColor = tint(paper, -0.012);
        shadowColor = rgb(paper[0] * 0.14, paper[1] * 0.14, paper[2] * 0.14);
        lineColor = "rgba(" + ink[0] + "," + ink[1] + "," + ink[2] + ",0.038)";
        edgeColor = "rgba(" + ink[0] + "," + ink[1] + "," + ink[2] + ",0.20)";
        var luminance = (paper[0] * 0.2126 + paper[1] * 0.7152 + paper[2] * 0.0722) / 255;
        var undersideMix = 0.09 + (1 - luminance) * 0.17;
        var underside = [
          paper[0] + (250 - paper[0]) * undersideMix,
          paper[1] + (245 - paper[1]) * undersideMix,
          paper[2] + (228 - paper[2]) * undersideMix
        ];
        for (var shade = 0; shade < SHADES; shade++) {
          var brightness = shade / (SHADES - 1);
          front[shade] = tint(paper, (brightness - 0.90) * 0.48);
          back[shade] = tint(underside, (brightness - 0.88) * 0.48);
        }
      }
      draw();
    }

    function scheduleRefresh() {
      if (destroyed || resizeFrame) return;
      resizeFrame = global.requestAnimationFrame(function () {
        resizeFrame = 0;
        refresh();
      });
    }

    function onDprChange() {
      if (destroyed) return;
      scheduleRefresh();
      watchDpr();
    }

    function watchDpr() {
      if (dprQuery) dprQuery.removeEventListener("change", onDprChange);
      if (typeof global.matchMedia !== "function") return;
      dprQuery = global.matchMedia("(resolution: " + (global.devicePixelRatio || 1) + "dppx)");
      dprQuery.addEventListener("change", onDprChange);
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frame) global.cancelAnimationFrame(frame);
      frame = 0;
      if (resizeFrame) global.cancelAnimationFrame(resizeFrame);
      resizeFrame = 0;
      if (dprQuery) dprQuery.removeEventListener("change", onDprChange);
      previousTime = 0;
      if (observer) observer.disconnect();
      global.removeEventListener("resize", scheduleRefresh);
      clear();
    }

    refresh();
    if (typeof global.ResizeObserver === "function") {
      observer = new global.ResizeObserver(scheduleRefresh);
      observer.observe(host);
    }
    // A monitor/DPR change can leave the CSS content size unchanged, so RO
    // alone is insufficient to keep the backing bitmap at device resolution.
    global.addEventListener("resize", scheduleRefresh);
    watchDpr();

    return { setTarget: setTarget, refresh: refresh, destroy: destroy };
  }

  global.StickyPaperPeel = { create: create };
})(window);

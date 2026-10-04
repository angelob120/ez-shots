// The client's watermark and reference photos, sent to their booking.
//
// Used by the booking form (book.html), which sends them the moment the
// booking exists, and by the booking page (manage.html), where they can be
// added or changed until the photos are sent. The booking's token is the only
// key, the same as everything else on the manage page.
(function () {
  // A phone photo is 3 to 12 MB. A reference only has to show a look, so it
  // is shrunk to 2000px on the long side before it goes. A logo keeps its
  // see through background and is only shrunk if it is over the limit.
  function shrink(file, max, type) {
    return new Promise(function (resolve) {
      if (!window.createImageBitmap || !document.createElement("canvas").toBlob) return resolve(file);
      createImageBitmap(file).then(function (img) {
        var k = Math.min(1, max / Math.max(img.width, img.height));
        if (k === 1 && type === "image/png") return resolve(file);
        var c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (blob) { resolve(blob && blob.size < file.size ? blob : file); }, type, 0.85);
      }).catch(function () { resolve(file); });
    });
  }

  // Resolves to the booking's brand fields after the upload.
  function upload(token, kind, file) {
    var ready = kind === "reference" ? shrink(file, 2000, "image/jpeg")
      : file.size > 5 * 1024 * 1024 ? shrink(file, 1600, "image/png") : Promise.resolve(file);
    return ready.then(function (blob) {
      return fetch("/api/manage/upload?t=" + encodeURIComponent(token) + "&kind=" + kind + "&name=" + encodeURIComponent(file.name || ""), {
        method: "POST", headers: { accept: "application/json" }, body: blob
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || (r.status === 413 ? "That file is too big." : "That upload did not go through. Try again."));
        return d.booking;
      });
    });
  }

  function saveBrand(token, prefs) {
    return fetch("/api/manage/brand?t=" + encodeURIComponent(token), {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(prefs)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || "That did not save. Try again.");
        return d.booking;
      });
    });
  }

  window.EZUploads = { MAX_REFERENCES: 12, shrink: shrink, upload: upload, saveBrand: saveBrand };
})();

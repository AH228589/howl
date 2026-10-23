// User settings, saved as JSON next to the app's other data.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  autoImport: true, // write HOWL item sets into the client in champ select
  autoAccept: false, // accept the queue pop
  overlay: true, // in-game overlay
  overlayPosition: 'right-middle', // right-middle | right-top | left-middle | left-top
  overlayScale: 0.9, // 0.75 small, 0.9 medium, 1.05 large
  overlayOpacity: 0.85,
  showGold: true,
  augmentReader: true, // read augment cards from the screen
  scanInterval: 1500,
  hotkeyOverlay: 'Control+Shift+H', // show or hide the overlay
  hotkeyScan: 'Control+Shift+J', // read the augment cards now
  allQueues: false, // also run outside ARAM: Mayhem (testing)
  riotApiKey: '', // the user's own key from developer.riotgames.com
  riotRoute: 'auto', // auto | americas | europe | asia | sea
  aramAuto: true, // collect ARAM stats in the background when a key is set
  autoPublish: true, // push collected stats to the HOWL repository for friends (git checkout only)
  // Used when there is no key: ARAM stats published with the HOWL repository.
  sharedStatsUrl: 'https://raw.githubusercontent.com/AH228589/howl/main/shared/aram-stats.json',
};

class Settings {
  constructor(file) {
    this.file = file;
    this.values = { ...DEFAULTS };
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      // 0.1 saved the old, larger overlay's scale; the compact panel starts fresh.
      if ('overlaySide' in saved) {
        saved.overlayPosition = `${saved.overlaySide === 'left' ? 'left' : 'right'}-middle`;
        delete saved.overlaySide;
        delete saved.overlayScale;
      }
      Object.assign(this.values, saved);
    } catch { /* defaults */ }
  }

  get(key) { return this.values[key]; }

  all() { return { ...this.values }; }

  update(patch) {
    for (const [k, v] of Object.entries(patch)) if (k in DEFAULTS) this.values[k] = v;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.values, null, 2));
    return this.all();
  }
}

module.exports = { Settings, DEFAULTS };

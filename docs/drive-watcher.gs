/**
 * ตัวเฝ้าไฟล์ DWG ใน Google Drive → สั่ง GitHub สร้างผังใหม่ทันทีที่ไฟล์เปลี่ยน
 * ติดตั้ง: script.google.com → โปรเจกต์ใหม่ → วางโค้ดนี้ → Project Settings > Script properties เพิ่ม
 *   GH_TOKEN  = fine-grained token ของ repo -cad-n1-viewer (สิทธิ์ Contents: Read and write)
 * แล้วเลือกฟังก์ชัน install กด Run ครั้งเดียว (อนุญาตสิทธิ์) จะตั้งให้ตรวจทุก 5 นาที
 */
var FOLDER_ID = '1mP47qarQZxPF-ln5Dy7VZrJlcq0uPJ4D';
var REPO = 'fabegasfang-maker/-cad-n1-viewer';

function latestDwgStamp_() {
  var best = 0;
  (function walk(folder) {
    var files = folder.getFiles();
    while (files.hasNext()) {
      var f = files.next();
      if (/\.dwg$/i.test(f.getName())) best = Math.max(best, f.getLastUpdated().getTime());
    }
    var subs = folder.getFolders();
    while (subs.hasNext()) walk(subs.next());
  })(DriveApp.getFolderById(FOLDER_ID));
  return best;
}

function check() {
  var props = PropertiesService.getScriptProperties();
  var stamp = String(latestDwgStamp_());
  if (stamp === '0' || stamp === props.getProperty('last')) return;
  var res = UrlFetchApp.fetch('https://api.github.com/repos/' + REPO + '/dispatches', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + props.getProperty('GH_TOKEN'), Accept: 'application/vnd.github+json' },
    contentType: 'application/json',
    payload: JSON.stringify({ event_type: 'drive-changed' }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() === 204) props.setProperty('last', stamp);
  else console.error(res.getResponseCode() + ' ' + res.getContentText());
}

function install() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('check').timeBased().everyMinutes(5).create();
}

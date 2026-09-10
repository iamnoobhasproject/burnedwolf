// BurnedWolf first-launch onboarding: language + update preference only.
const { ipcRenderer } = require('electron');
const i18n = require('./i18n');
const $ = (id) => document.getElementById(id);
const TOTAL = 2;
let lang = null, wantUpdate = null;
const stepLanguage = $('step-language'), stepUpdate = $('step-update');
const btnLangNext = $('btnLangNext'), btnFinish = $('btnUpdateFinish');
function stepNo(){ return stepLanguage.classList.contains('on') ? 1 : 2; }
function go(el){ document.querySelectorAll('.step').forEach(s=>s.classList.remove('on')); el.classList.add('on'); $('stepIndicator').textContent=i18n.t('onboard.step',{n:stepNo(),total:TOTAL}); }
document.querySelectorAll('.lang').forEach(t=>t.addEventListener('click',()=>{ document.querySelectorAll('.lang').forEach(x=>x.classList.remove('sel')); t.classList.add('sel'); lang=t.dataset.lang; btnLangNext.disabled=false; paint(lang); }));
btnLangNext.addEventListener('click',async()=>{ if(!lang)return; await ipcRenderer.invoke('settings-set','language',lang); go(stepUpdate); });
document.querySelectorAll('.choice[data-update]').forEach(t=>t.addEventListener('click',()=>{ document.querySelectorAll('.choice[data-update]').forEach(x=>x.classList.remove('sel')); t.classList.add('sel'); wantUpdate=t.dataset.update==='yes'; btnFinish.disabled=false; }));
btnFinish.addEventListener('click',async()=>{ if(wantUpdate===null)return; await ipcRenderer.invoke('settings-set','auto_update',wantUpdate); await ipcRenderer.invoke('settings-set','onboarded',true); ipcRenderer.send('onboarding-complete'); });
function paint(l){ i18n.loadLang(l); $('langTitle').textContent=i18n.t('onboard.lang_title'); $('langWhy').textContent=i18n.t('onboard.lang_sub'); btnLangNext.textContent=i18n.t('common.continue'); $('updateTitle').textContent=i18n.t('onboard.update_title'); $('updateSubtitle').textContent=i18n.t('onboard.update_sub'); $('updateYesName').textContent=i18n.t('onboard.update_yes'); $('updateYesDesc').textContent=i18n.t('onboard.update_yes_desc'); $('updateNoName').textContent=i18n.t('onboard.update_no'); $('updateNoDesc').textContent=i18n.t('onboard.update_no_desc'); btnFinish.textContent=i18n.t('onboard.finish'); $('footerHint').textContent=i18n.t('onboard.footer'); $('stepIndicator').textContent=i18n.t('onboard.step',{n:stepNo(),total:TOTAL}); }
paint('en');

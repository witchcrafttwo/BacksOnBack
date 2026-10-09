// ランキングに出す「なまえ」を入れる小さな画面。
// キャンバスの上に HTML で重ねる(スマホでもキーボードが出るように)。中身は index.html の #name-dialog
import { NAME_MAX, cleanName } from './ranking.js';

/** なまえを聞く。「きめる」で整えたなまえ、「やめる」・Esc で null */
export function askName(current) {
  const root = document.getElementById('name-dialog');
  const form = root.querySelector('form');
  const input = root.querySelector('input');
  const cancel = root.querySelector('[data-cancel]');
  input.maxLength = NAME_MAX;
  input.value = current;
  root.hidden = false;
  input.focus();
  input.select();

  return new Promise((resolve) => {
    const close = (value) => {
      form.removeEventListener('submit', onSubmit);
      cancel.removeEventListener('click', onCancel);
      root.removeEventListener('keydown', onKey);
      input.blur(); // スマホのキーボードを閉じる
      root.hidden = true;
      resolve(value);
    };
    const onSubmit = (e) => {
      e.preventDefault();
      const name = cleanName(input.value);
      if (name) close(name);
      else input.focus();
    };
    const onCancel = () => close(null);
    const onKey = (e) => {
      // 文字を打っている間は、ゲームの操作(スペースで落とす など)に届けない
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        close(null);
      }
    };
    form.addEventListener('submit', onSubmit);
    cancel.addEventListener('click', onCancel);
    root.addEventListener('keydown', onKey);
  });
}

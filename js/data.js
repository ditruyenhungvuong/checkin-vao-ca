/* =========================================================
   Dữ liệu tĩnh – Check-in khi vào ca
   Nhãn mức và thẻ cảm xúc lấy NGUYÊN VĂN PRD Phụ lục A.3, A.4.
   Chỉ lưu tên file ảnh; app.js ghép APP_CONFIG.ASSET_BASE + image.
   ========================================================= */
window.APP_DATA = (() => {
  /* ===== 10 mức "Hôm nay anh/chị cảm thấy như thế nào?" =====
     index 0 để null vì không có mức 0 (thanh trượt chạy 1..10). */
  const LEVELS = [null,
    { n: 1,  text: 'Rất mệt',     image: 'capy-level-01.png', emoji: '😩' },
    { n: 2,  text: 'Mệt',         image: 'capy-level-02.png', emoji: '😫' },
    { n: 3,  text: 'Hơi mệt',     image: 'capy-level-03.png', emoji: '😔' },
    { n: 4,  text: 'Hơi uể oải',  image: 'capy-level-04.png', emoji: '😕' },
    { n: 5,  text: 'Bình thường', image: 'capy-level-05.png', emoji: '😐' },
    { n: 6,  text: 'Tạm ổn',      image: 'capy-level-06.png', emoji: '🙂' },
    { n: 7,  text: 'Ổn',          image: 'capy-level-07.png', emoji: '😊' },
    { n: 8,  text: 'Khá tốt',     image: 'capy-level-08.png', emoji: '😄' },
    { n: 9,  text: 'Tốt',         image: 'capy-level-09.png', emoji: '😁' },
    { n: 10, text: 'Rất tốt',     image: 'capy-level-10.png', emoji: '🤩' }
  ];

  /* ===== 6 thẻ Capybara, đúng thứ tự lưới và đúng bộ ảnh repo nhatkymebau =====
     code chỉ dùng trong DOM (data-emotion); cột Sheet ghi label. */
  const EMOTIONS = [
    { code: 'happy',     label: 'Vui vẻ',    image: 'vui.jpg',       emoji: '😊' },
    { code: 'sad',       label: 'Buồn',      image: 'buon.jpg',      emoji: '😢' },
    { code: 'worried',   label: 'Lo lắng',   image: 'khoc.jpg',      emoji: '😟' },
    { code: 'angry',     label: 'Tức giận',  image: 'tuc.jpg',       emoji: '😠' },
    { code: 'panicked',  label: 'Hoảng hốt', image: 'hoang_hot.jpg', emoji: '😨' },
    { code: 'irritated', label: 'Khó chịu',  image: 'kho_chiu.jpg',  emoji: '😩' }
  ];

  return { LEVELS, EMOTIONS, DEFAULT_LEVEL: 5 };
})();

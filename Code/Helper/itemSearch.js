// Search aliases only; canonical names/IDs and trading values never change.
const aliases = {
  'frost dragon': ['ледяной дракон', 'морозный дракон', 'фрост дракон'],
  'shadow dragon': ['теневой дракон', 'шадоу дракон'],
  'bat dragon': ['дракон летучая мышь', 'бэт дракон'],
  'ancient dragon': ['древний дракон'],
  'arctic reindeer': ['арктический олень'],
  'snow owl': ['снежная сова'],
  'safari egg': ['яйцо сафари'],
  'jungle egg': ['яйцо джунглей'],
  'royal egg': ['королевское яйцо'],
  'cracked egg': ['треснувшее яйцо'],
  'pet egg': ['яйцо питомца'],
  'icewing': ['ледяное крыло', 'айсвинг'],
  'chroma': ['хрома'],
  'harvester': ['харвестер', 'жнец'],
  'candy': ['конфета', 'кэнди'],
  'sugar': ['сахар', 'шугар'],
  'luger': ['люгер'],
  'icebreaker': ['ледокол', 'айсбрейкер'],
  'elderwood': ['элдервуд'],
  'lightbringer': ['лайтбрингер'],
  'darkbringer': ['даркбрингер'],
  'godly': ['годли'],
  'dragon': ['дракон'], 'unicorn': ['единорог'], 'owl': ['сова'],
  'parrot': ['попугай'], 'giraffe': ['жираф'], 'turtle': ['черепаха'],
  'kangaroo': ['кенгуру'], 'cow': ['корова'], 'dog': ['собака'],
  'cat': ['кот', 'кошка'], 'shark': ['акула'], 'egg': ['яйцо', 'яйца'],
  'phoenix': ['феникс'], 'buddha': ['будда'], 'dough': ['тесто'],
  'venom': ['яд', 'веном'], 'leopard': ['леопард'], 'kitsune': ['кицунэ', 'китсуне'],
  'yeti': ['йети'], 'gas': ['газ'], 'light': ['свет'], 'dark': ['тьма'],
  'ice': ['лёд', 'лед'], 'flame': ['пламя'], 'magma': ['магма'],
  'portal': ['портал'], 'rumble': ['грохот'], 'spirit': ['дух'],
};

// Japanese: katakana names players type (plus a few kanji and pre-rename names).
const jaAliases = {
  'west dragon': ['ウエストドラゴン', 'ウェストドラゴン', '西ドラゴン'],
  'east dragon': ['イーストドラゴン', '東ドラゴン'],
  'dragon': ['ドラゴン', '竜', '龍'], 'kitsune': ['キツネ', '狐'], 'control': ['コントロール'],
  'magnet': ['マグネット', '磁石'], 'yeti': ['イエティ'], 'gas': ['ガス'],
  'tiger': ['タイガー', 'トラ', '虎', 'レオパード', 'ヒョウ'], 'lightning': ['ライトニング', '雷', 'ランブル', 'ゴロゴロ'],
  'venom': ['ヴェノム', 'ベノム'], 'dough': ['ドウ', 'モチ'], 'pain': ['ペイン'], 't-rex': ['ティーレックス', 'ティラノ'],
  'gravity': ['グラビティ', '重力'], 'mammoth': ['マンモス'], 'spirit': ['スピリット'], 'shadow': ['シャドウ', 'シャドー', '影'],
  'portal': ['ポータル'], 'buddha': ['ブッダ', '大仏'], 'blizzard': ['ブリザード'], 'creation': ['クリエイション', 'バリア'],
  'phoenix': ['フェニックス', '不死鳥'], 'sound': ['サウンド'], 'spider': ['スパイダー'], 'love': ['ラブ'],
  'magma': ['マグマ'], 'quake': ['クエイク', 'グラグラ'], 'diamond': ['ダイヤモンド', 'ダイヤ'], 'light': ['ライト', '光'],
  'ghost': ['ゴースト'], 'eagle': ['イーグル', 'ファルコン'], 'rubber': ['ラバー', 'ゴム'], 'ice': ['アイス', '氷'],
  'sand': ['サンド', '砂'], 'dark': ['ダーク', '闇'], 'flame': ['フレイム', '炎'], 'spike': ['スパイク'],
  'smoke': ['スモーク', '煙'], 'bomb': ['ボム', '爆弾'], 'spring': ['スプリング', 'バネ'], 'blade': ['ブレード', 'チョップ'],
  'spin': ['スピン'], 'rocket': ['ロケット'], 'permanent': ['パーマネント', '永久'],
};
for (const [english, names] of Object.entries(jaAliases)) {
  aliases[english] = [...(aliases[english] || []), ...names];
}

// NFKC folds full-width/half-width forms; hiragana is folded to katakana so
// "きつね" finds キツネ.
const normalize = value => String(value || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/ё/g, 'е')
  .replace(/[ぁ-ゖ]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60))
  .trim();

export const matchesItemName = (name, query, acronym = false) => {
  const needle = normalize(query);
  if (!needle) return true;
  const canonical = normalize(name);
  if (!canonical) return false;
  if (canonical.includes(needle)) return true;
  if (acronym && canonical.split(/[\s_-]+/).map(word => word[0] || '').join('').includes(needle)) return true;
  // Whole English words avoid matching “cat” in an unrelated item name.
  return Object.entries(aliases).some(([english, translations]) => {
    const words = canonical.replace(/[-_]/g, ' ');
    if (!(` ${words} `).includes(` ${english} `)) return false;
    return translations.some(alias => normalize(alias).includes(needle));
  });
};

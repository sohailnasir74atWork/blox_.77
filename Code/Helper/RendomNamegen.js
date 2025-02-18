
const ONE_PIECE_CHARACTERS = [
    // Straw Hat Pirates
    'MonkeyD.Luffy',
    'RoronoaZoro',
    'Nami',
    'Usopp',
    'Sanji',
    'TonyTonyChopper',
    'NicoRobin',
    'Franky',
    'Brook',
    'Jinbe',
  
    // Supernovas
    'TrafalgarLaw',
    'EustassKid',
    'Killer',
    'JewelryBonney',
    'ScratchmenApoo',
    'CaponeBege',
    'BasilHawkins',
    'XDrake',
    'Urouge',
  
    // Yonko (Emperors of the Sea)
    'Shanks',
    'Kaido',
    'BigMom',
    'Blackbeard',
    'Whitebeard',
  
    // Marine Admirals
    'Akainu',
    'Aokiji',
    'Kizaru',
    'Fujitora',
    'Ryokugyu',
    'Sengoku',
  
    // Revolutionary Army
    'MonkeyD.Dragon',
    'Sabo',
    'Ivankov',
    'Koala',
    'BeloBetty',
  
    // Seven Warlords of the Sea
    'DraculeMihawk',
    'BoaHancock',
    'Crocodile',
    'DonquixoteDoflamingo',
    'BartholomewKuma',
    'GeckoMoria',
    'Jinbe', // Before joining the Straw Hats
    'BuggyTheClown',
    'EdwardWeevil',
  
    // Other Major Characters
    'GolD.Roger',
    'PortgasD.Ace',
    'SilversRayleigh',
    'ScopperGaban',
    'ShikiTheGoldenLion',
    'MarcoThePhoenix',
    'OdenKozuki',
    'Yamato',
  
    // Villains
    'Arlong',
    'Enel',
    'Magellan',
    'HodyJones',
    'CaesarClown',
    'CharlotteKatakuri',
    'JackTheDrought',
    'QueenThePlague',
    'KingTheWildfire',
  
    // Celestial Dragons
    'SaintCharloss',
    'SaintRosward',
  
    // Mink Tribe
    'Carrot',
    'Pedro',
    'Pekoms',
  
    // Kozuki Clan
    'Momonosuke',
    'Kinemon',
    'Kanjuro',
    'Raizo',
  
    // Other Notable Characters
    'ViviNefertari',
    'Rebecca',
    'Shirahoshi',
    'Pell',
    'Coby',
    'Helmeppo',
    'Hina',
    'Smoker',
    'Tashigi',
    'Vergo',
    'Monet',
  
    // Comedy/Support Characters
    'BuggyTheClown',
    'Mr.2BonClay',
    'Mr.3Galdino',
    'Pauly',
    'Koby',
    'Duval',
  
    // Giants
    'Dorry',
    'Broggy',
    'Hajrudin',
  
    // Skypiea
    'GanFall',
    'Conis',
    'Wyper',
  ];
  

  export const generateOnePieceUsername = () => {
    const randomName = ONE_PIECE_CHARACTERS[Math.floor(Math.random() * ONE_PIECE_CHARACTERS.length)];
    const randomNumber = Math.floor(1000 + Math.random() * 9000); // Random 4-digit number
    return `${randomName}_${randomNumber}`;
  };
  

  
  
  
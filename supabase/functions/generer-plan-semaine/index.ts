// supabase/functions/generer-plan-semaine/index.ts
// BATCH v2.1 :
// - 1 appel LLM pour les 21 repas complets (instructions incluses)
// - Mémoire persistante : await du save pour garantir l'écriture en base
// - force_refresh: true pour forcer une nouvelle génération

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

// ─── Rate limiting : 10 générations/heure par utilisateur ──────────────────
const _planRateLimitMap = new Map<string, number[]>();
const PLAN_RATE_LIMIT_MAX = 10;
const PLAN_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 heure

function checkPlanRateLimit(profilId: string): boolean {
  const now = Date.now();
  const calls = (_planRateLimitMap.get(profilId) || []).filter(t => now - t < PLAN_RATE_LIMIT_WINDOW_MS);
  if (calls.length >= PLAN_RATE_LIMIT_MAX) return false;
  calls.push(now);
  _planRateLimitMap.set(profilId, calls);
  return true;
}

const JOURS_SEMAINE = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const STYLES_CULINAIRES = ['mediterraneen', 'asiatique', 'francais', 'italien', 'mexicain', 'nordique', 'oriental'];

// ─── Utilitaires ────────────────────────────────────────────────────────────

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normaliserArray(valeur: any): string[] {
  if (!valeur) return [];
  if (Array.isArray(valeur)) return valeur.filter(Boolean);
  if (typeof valeur === 'string') {
    return valeur
      .replace(/^\{|\}$/g, '')
      .split(/,(?![^{]*})/)
      .map((s: string) => s.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);
  }
  return [];
}

function estPoisson(nom: string): boolean {
  const n = nom.toLowerCase();
  return ['saumon', 'maquereau', 'sardine', 'thon', 'truite', 'cabillaud', 'dorade', 'flétan', 'bar', 'sole'].some(p => n.includes(p));
}

function estCategorieAnimale(cat: string): boolean {
  const c = cat.toLowerCase();
  return ['viande', 'volaille', 'poisson', 'fruits de mer', 'crustacé', 'mollusque',
    'abats', 'gibier', 'œuf', 'oeuf', 'produit laitier', 'fromage', 'laitier'].some(m => c.includes(m));
}

function estViandePoissonCrustace(cat: string): boolean {
  const c = cat.toLowerCase();
  return ['viande', 'volaille', 'poisson', 'fruits de mer', 'crustacé', 'mollusque', 'abats', 'gibier'].some(m => c.includes(m));
}

// ─── Collation par défaut (sans LLM) ───────────────────────────────────────

const COLLATIONS_POOL: Array<{
  nom: string;
  ingredients: { nom: string; quantite: number; unite: string }[];
  instructions: string[];
  temps_preparation: number;
  temps_cuisson: number;
  portions: number;
  valeurs_nutritionnelles: { calories: number; proteines: number; glucides: number; lipides: number };
  astuces: string[];
  contientLaitier?: boolean;
}> = [
  {
    nom: 'Pomme & Beurre d\'Amande',
    ingredients: [
      { nom: 'Pomme', quantite: 1, unite: 'pièce' },
      { nom: 'Beurre d\'amande', quantite: 20, unite: 'g' },
    ],
    instructions: ['Laver la pomme et la couper en quartiers.', 'Tremper chaque quartier dans le beurre d\'amande.'],
    temps_preparation: 3, temps_cuisson: 0, portions: 1,
    valeurs_nutritionnelles: { calories: 180, proteines: 4, glucides: 22, lipides: 9 },
    astuces: ['La pectine de la pomme nourrit le microbiome ; les graisses de l\'amande prolongent la satiété.'],
  },
  {
    nom: 'Carré de Chocolat Noir & Noix du Brésil',
    ingredients: [
      { nom: 'Chocolat noir 70%+', quantite: 20, unite: 'g' },
      { nom: 'Noix du Brésil', quantite: 3, unite: 'pièces' },
    ],
    instructions: ['Laisser fondre lentement le chocolat en bouche.', 'Croquer les noix du Brésil.'],
    temps_preparation: 1, temps_cuisson: 0, portions: 1,
    valeurs_nutritionnelles: { calories: 145, proteines: 3, glucides: 10, lipides: 11 },
    astuces: ['3 noix du Brésil couvrent 100% des besoins en sélénium. Le cacao apporte 64mg de magnésium.'],
  },
  {
    nom: 'Banane & Noix de Cajou',
    ingredients: [
      { nom: 'Banane', quantite: 1, unite: 'pièce' },
      { nom: 'Noix de cajou', quantite: 25, unite: 'g' },
    ],
    instructions: ['Éplucher la banane et la couper en rondelles.', 'Servir avec les noix de cajou dans un petit bol.'],
    temps_preparation: 2, temps_cuisson: 0, portions: 1,
    valeurs_nutritionnelles: { calories: 200, proteines: 5, glucides: 30, lipides: 8 },
    astuces: ['Le tryptophane de la banane et le magnésium des noix de cajou soutiennent la sérotonine.'],
  },
  {
    nom: 'Kiwi & Amandes Effilées',
    ingredients: [
      { nom: 'Kiwi', quantite: 2, unite: 'pièces' },
      { nom: 'Amandes effilées', quantite: 15, unite: 'g' },
    ],
    instructions: ['Éplucher et couper les kiwis en dés.', 'Disposer dans un bol et parsemer d\'amandes effilées.'],
    temps_preparation: 3, temps_cuisson: 0, portions: 1,
    valeurs_nutritionnelles: { calories: 150, proteines: 4, glucides: 20, lipides: 6 },
    astuces: ['2 kiwis par jour améliorent la qualité du sommeil grâce à leur teneur en sérotonine et antioxydants.'],
  },
  {
    nom: 'Dattes Medjool & Noix',
    ingredients: [
      { nom: 'Dattes Medjool', quantite: 2, unite: 'pièces' },
      { nom: 'Noix', quantite: 20, unite: 'g' },
    ],
    instructions: ['Dénoyauter les dattes si nécessaire.', 'Déguster avec les noix en mâchant lentement.'],
    temps_preparation: 1, temps_cuisson: 0, portions: 1,
    valeurs_nutritionnelles: { calories: 190, proteines: 3, glucides: 28, lipides: 8 },
    astuces: ['Les dattes offrent un index glycémique modéré et les oméga-3 des noix réduisent l\'inflammation.'],
  },
  {
    nom: 'Yaourt Nature & Myrtilles',
    ingredients: [
      { nom: 'Yaourt nature entier', quantite: 125, unite: 'g' },
      { nom: 'Myrtilles fraîches ou surgelées', quantite: 60, unite: 'g' },
      { nom: 'Graines de chia', quantite: 5, unite: 'g' },
    ],
    instructions: ['Verser le yaourt dans un bol.', 'Ajouter les myrtilles et les graines de chia.'],
    temps_preparation: 2, temps_cuisson: 0, portions: 1,
    valeurs_nutritionnelles: { calories: 160, proteines: 7, glucides: 18, lipides: 5 },
    astuces: ['Les probiotiques du yaourt et les polyphénols des myrtilles forment un duo gagnant pour le microbiome.'],
    contientLaitier: true,
  },
  {
    nom: 'Crackers Seigle & Houmous',
    ingredients: [
      { nom: 'Crackers au seigle', quantite: 3, unite: 'pièces' },
      { nom: 'Houmous', quantite: 40, unite: 'g' },
      { nom: 'Rondelles de concombre', quantite: 5, unite: 'pièces' },
    ],
    instructions: ['Étaler l\'houmous sur les crackers.', 'Déposer les rondelles de concombre par-dessus.'],
    temps_preparation: 3, temps_cuisson: 0, portions: 1,
    valeurs_nutritionnelles: { calories: 170, proteines: 6, glucides: 22, lipides: 6 },
    astuces: ['Les fibres du seigle et les protéines végétales des pois chiches assurent une satiété durable.'],
  },
];

function collationParDefaut(profil: any, jourIndex: number = 0): any {
  const estSansLactose = profil.estSansLactose;
  const pool = COLLATIONS_POOL.filter(c => !(estSansLactose && c.contientLaitier));
  const poolEffectif = pool.length > 0 ? pool : COLLATIONS_POOL;
  const idx = jourIndex % poolEffectif.length;
  const { contientLaitier: _, instructions: _inst, ...collation } = poolEffectif[idx];
  return { ...collation, instructions: [], type_repas: 'collation', style_culinaire: 'maison', genere_par_llm: false };
}

// ─── Fallback semaine complet ──────────────────────────────────────────────

function recetteFallbackUnitaire(
  typeRepas: string,
  proteineAssignee: string | null,
  styleCulinaire: string,
  jourIndex: number
): any {
  if (typeRepas === 'petit-dejeuner') {
    const PETIT_DEJ_FALLBACKS = [
      { nom: 'Porridge Avoine Banane & Amandes',
        ingredients: [{ nom: "Flocons d'avoine", quantite: 60, unite: 'g' }, { nom: 'Lait végétal', quantite: 200, unite: 'ml' }, { nom: 'Banane', quantite: 1, unite: 'pièce' }, { nom: 'Amandes effilées', quantite: 15, unite: 'g' }, { nom: 'Miel', quantite: 10, unite: 'g' }],
        instructions: ["Chauffer le lait végétal à feu moyen dans une casserole.", "Ajouter les flocons d'avoine et remuer 3 min jusqu'à consistance crémeuse.", "Verser dans un bol, déposer la banane tranchée, les amandes et le miel."],
        valeurs_nutritionnelles: { calories: 380, proteines: 10, glucides: 62, lipides: 9 } },
      { nom: 'Smoothie Bowl Fruits Rouges & Granola',
        ingredients: [{ nom: 'Fruits rouges surgelés', quantite: 150, unite: 'g' }, { nom: 'Banane congelée', quantite: 1, unite: 'pièce' }, { nom: 'Lait végétal', quantite: 80, unite: 'ml' }, { nom: 'Granola', quantite: 40, unite: 'g' }],
        instructions: ["Mixer les fruits rouges, la banane congelée et le lait végétal jusqu'à texture épaisse.", "Verser dans un bol large.", "Parsemer de granola et servir immédiatement."],
        valeurs_nutritionnelles: { calories: 360, proteines: 8, glucides: 58, lipides: 10 } },
      { nom: 'Tartines Avocat & Citron',
        ingredients: [{ nom: 'Pain complet', quantite: 2, unite: 'tranches' }, { nom: 'Avocat mûr', quantite: 1, unite: 'pièce' }, { nom: 'Citron', quantite: 0.5, unite: 'pièce' }],
        instructions: ["Toaster le pain 2 min au grille-pain.", "Écraser la chair de l'avocat avec le jus de citron, sel et poivre.", "Tartiner généreusement sur les toasts."],
        valeurs_nutritionnelles: { calories: 340, proteines: 9, glucides: 38, lipides: 18 } },
      { nom: 'Overnight Oats Mangue & Coco',
        ingredients: [{ nom: "Flocons d'avoine", quantite: 60, unite: 'g' }, { nom: 'Lait de coco', quantite: 150, unite: 'ml' }, { nom: 'Mangue', quantite: 100, unite: 'g' }],
        instructions: ["La veille : mélanger les flocons avec le lait de coco, couvrir et réfrigérer toute la nuit.", "Le matin : couper la mangue en dés.", "Déposer la mangue sur les oats et servir frais."],
        valeurs_nutritionnelles: { calories: 400, proteines: 9, glucides: 65, lipides: 12 } },
      { nom: 'Bol Yaourt Kiwi & Graines',
        ingredients: [{ nom: 'Yaourt grec', quantite: 150, unite: 'g' }, { nom: 'Kiwi', quantite: 2, unite: 'pièces' }, { nom: 'Graines de courge', quantite: 15, unite: 'g' }],
        instructions: ["Verser le yaourt grec dans un bol.", "Éplucher et trancher les kiwis, disposer sur le yaourt.", "Parsemer de graines de courge et servir."],
        valeurs_nutritionnelles: { calories: 290, proteines: 14, glucides: 35, lipides: 9 } },
      { nom: 'Crêpe Sarrasin Pomme & Cannelle',
        ingredients: [{ nom: 'Farine de sarrasin', quantite: 60, unite: 'g' }, { nom: 'Lait végétal', quantite: 120, unite: 'ml' }, { nom: 'Pomme', quantite: 1, unite: 'pièce' }],
        instructions: ["Mélanger la farine et le lait jusqu'à pâte lisse.", "Cuire la crêpe 2 min de chaque côté dans une poêle légèrement huilée.", "Garnir de pomme râpée et d'une pincée de cannelle."],
        valeurs_nutritionnelles: { calories: 330, proteines: 8, glucides: 60, lipides: 5 } },
      { nom: 'Tartine Ricotta & Fraises',
        ingredients: [{ nom: 'Pain de campagne', quantite: 2, unite: 'tranches' }, { nom: 'Ricotta', quantite: 80, unite: 'g' }, { nom: 'Fraises fraîches', quantite: 100, unite: 'g' }],
        instructions: ["Toaster le pain 2 min au grille-pain.", "Étaler la ricotta généreusement sur chaque tranche.", "Disposer les fraises coupées en deux et arroser d'un filet de miel."],
        valeurs_nutritionnelles: { calories: 320, proteines: 11, glucides: 45, lipides: 9 } },
    ];
    const fb = PETIT_DEJ_FALLBACKS[jourIndex % PETIT_DEJ_FALLBACKS.length];
    return {
      nom: fb.nom,
      type_repas: 'petit-dejeuner',
      style_culinaire: 'maison',
      ingredients: fb.ingredients,
      instructions: fb.instructions,
      temps_preparation: 10,
      temps_cuisson: 0,
      portions: 1,
      valeurs_nutritionnelles: fb.valeurs_nutritionnelles,
      astuces: [],
      variantes: [],
      genere_par_llm: false,
    };
  }

  const prot = proteineAssignee || 'Filet de poulet';
  const protLow = prot.toLowerCase();
  let nom: string;
  let ingredients: any[];
  let calories = 430, proteines = 28;

  let instructions: string[];

  if (protLow.includes('maquereau') || protLow.includes('sardine') || protLow.includes('hareng')) {
    nom = `${prot} en papillote aux herbes`;
    ingredients = [{ nom: prot, quantite: 160, unite: 'g' }, { nom: 'Tomates cerises', quantite: 150, unite: 'g' }, { nom: 'Courgette', quantite: 150, unite: 'g' }, { nom: 'Citron', quantite: 1, unite: 'pièce' }, { nom: 'Herbes de Provence', quantite: 5, unite: 'g' }];
    instructions = ['Préchauffer le four à 200°C. Couper la courgette en rondelles et les tomates en deux.', 'Déposer les légumes sur du papier sulfurisé, arroser d\'huile d\'olive et parsemer d\'herbes.', 'Placer le poisson par-dessus, presser le citron et refermer hermétiquement la papillote.', 'Enfourner 18 min. Ouvrir avec précaution à la sortie du four et servir.'];
    calories = 380; proteines = 26;
  } else if (protLow.includes('saumon') || protLow.includes('truite') || protLow.includes('cabillaud') || protLow.includes('dorade') || protLow.includes('bar')) {
    nom = `${prot} poêlé au citron`;
    ingredients = [{ nom: prot, quantite: 160, unite: 'g' }, { nom: 'Haricots verts', quantite: 180, unite: 'g' }, { nom: 'Citron', quantite: 1, unite: 'pièce' }, { nom: 'Câpres', quantite: 10, unite: 'g' }];
    instructions = ['Blanchir les haricots verts 6 min dans l\'eau bouillante salée, égoutter et réserver.', 'Chauffer une poêle à feu vif avec un filet d\'huile d\'olive.', 'Cuire le poisson côté peau 4 min sans y toucher, retourner et cuire 2 min.', 'Ajouter les câpres et le jus de citron. Servir avec les haricots verts.'];
    calories = 400; proteines = 30;
  } else if (protLow.includes('poulet') || protLow.includes('dinde')) {
    nom = `${prot} rôti aux légumes`;
    ingredients = [{ nom: prot, quantite: 160, unite: 'g' }, { nom: 'Poivron rouge', quantite: 120, unite: 'g' }, { nom: 'Courgette', quantite: 120, unite: 'g' }, { nom: 'Huile d\'olive', quantite: 15, unite: 'ml' }];
    instructions = ['Préchauffer le four à 200°C. Couper les légumes en morceaux de 3 cm.', 'Déposer dans un plat, arroser d\'huile d\'olive, saler et poivrer. Mélanger.', 'Placer la viande par-dessus et enfourner 25-30 min jusqu\'à dorure.', 'Laisser reposer 3 min avant de servir.'];
    calories = 440; proteines = 34;
  } else if (protLow.includes('bœuf') || protLow.includes('boeuf') || protLow.includes('steak')) {
    nom = `${prot} poêlé, purée de patate douce`;
    ingredients = [{ nom: prot, quantite: 150, unite: 'g' }, { nom: 'Patate douce', quantite: 200, unite: 'g' }, { nom: 'Épinards frais', quantite: 100, unite: 'g' }];
    instructions = ['Cuire la patate douce épluchée en cubes 15 min à l\'eau bouillante, écraser en purée.', 'Chauffer une poêle à feu très vif. Saisir la viande 2-3 min de chaque côté.', 'Dans la même poêle, faire tomber les épinards 2 min à feu moyen.', 'Servir la viande tranchée sur la purée, accompagnée des épinards.'];
    calories = 480; proteines = 36;
  } else if (protLow.includes('lentille') || protLow.includes('pois chiche') || protLow.includes('tofu') || protLow.includes('tempeh')) {
    nom = `${prot} mijotés aux épices`;
    ingredients = [{ nom: prot, quantite: 180, unite: 'g' }, { nom: 'Tomates concassées', quantite: 200, unite: 'g' }, { nom: 'Oignon', quantite: 100, unite: 'g' }, { nom: 'Cumin, curcuma', quantite: 5, unite: 'g' }];
    instructions = ['Faire revenir l\'oignon émincé dans l\'huile d\'olive 5 min à feu moyen.', 'Ajouter le cumin et le curcuma, faire revenir 1 min pour libérer les arômes.', 'Incorporer les tomates et la protéine. Mélanger et couvrir.', 'Mijoter 15-20 min à feu doux en remuant régulièrement.'];
    calories = 390; proteines = 20;
  } else {
    nom = `${prot} poêlé aux légumes`;
    ingredients = [{ nom: prot, quantite: 150, unite: 'g' }, { nom: 'Légumes de saison', quantite: 250, unite: 'g' }, { nom: 'Huile d\'olive', quantite: 15, unite: 'ml' }];
    instructions = ['Couper les légumes et la protéine en morceaux réguliers.', 'Chauffer l\'huile dans une grande poêle ou wok à feu vif.', 'Faire revenir l\'oignon et l\'ail 2 min, puis ajouter les légumes et la protéine.', 'Cuire 8-10 min à feu moyen en remuant. Assaisonner et servir.'];
  }

  return {
    nom,
    type_repas: typeRepas,
    style_culinaire: styleCulinaire,
    ingredients,
    instructions,
    temps_preparation: 10,
    temps_cuisson: 20,
    portions: 2,
    valeurs_nutritionnelles: { calories, proteines, glucides: 40, lipides: 14 },
    astuces: [],
    variantes: [],
    genere_par_llm: false,
  };
}

function fallbackSemaine(pairesProteines: [string, string][], stylesJours: string[], profilNorm: any): Record<string, any> {
  const semaine: Record<string, any> = {};
  for (let j = 0; j < 7; j++) {
    const jour = JOURS_SEMAINE[j];
    const style = stylesJours[j];
    const [protDej, protDin] = pairesProteines[j];
    semaine[jour] = {
      petit_dejeuner: recetteFallbackUnitaire('petit-dejeuner', null, style, j),
      dejeuner: recetteFallbackUnitaire('dejeuner', protDej, style, j),
      diner: recetteFallbackUnitaire('diner', protDin, style, j),
      pause: collationParDefaut(profilNorm, j),
    };
  }
  return semaine;
}

// ─── Chargement aliments depuis BDD ────────────────────────────────────────

async function chargerAliments(supabase: any, besoins: string[], profilNorm: any): Promise<any[]> {
  const besoinsActifs = besoins.length > 0
    ? besoins
    : ['vitalite', 'serenite', 'sommeil', 'digestion', 'mobilite', 'hormones'];

  const { data, error } = await supabase
    .from('alimentation_besoins')
    .select('besoin_id, score, alimentation(*)')
    .in('besoin_id', besoinsActifs);

  if (error || !data?.length) {
    console.warn('[WARN] alimentation_besoins vide:', error?.message);
    return [];
  }

  const alimentMap = new Map<string, any>();
  for (const row of data as any[]) {
    const a = row.alimentation;
    if (!a) continue;
    const nomKey = (a.nom || '').toLowerCase().trim();
    const existing = alimentMap.get(nomKey);
    if (!existing || (existing.besoin_score || 0) < (row.score || 0)) {
      alimentMap.set(nomKey, { ...a, besoin_score: row.score || 1 });
    }
  }

  let aliments = Array.from(alimentMap.values());

  if (profilNorm.estVegan) {
    aliments = aliments.filter(a => !estCategorieAnimale(a.categorie || ''));
  } else if (profilNorm.estVegetarien) {
    aliments = aliments.filter(a => !estViandePoissonCrustace(a.categorie || ''));
  }
  if (profilNorm.estSansLactose) {
    aliments = aliments.filter(a => {
      const cat = (a.categorie || '').toLowerCase();
      const nom = (a.nom || '').toLowerCase();
      return !cat.includes('laitier') && !cat.includes('fromage') && !cat.includes('yaourt')
        && !nom.includes('yaourt') && !nom.includes('fromage') && !nom.includes('ricotta');
    });
  }

  return aliments;
}

// ─── Wellness depuis BDD ───────────────────────────────────────────────────

async function chargerWellness(supabase: any, besoins: string[]): Promise<{
  nutraceutiques: any[], aromatherapie: any[], routines: any[]
}> {
  const besoinsActifs = besoins.length > 0
    ? besoins
    : ['vitalite', 'serenite', 'sommeil', 'digestion', 'mobilite', 'hormones'];

  const [resNutra, resAro, resRoutines] = await Promise.all([
    supabase.from('nutraceutiques_besoins').select('besoin_id, score, nutraceutiques(*)').in('besoin_id', besoinsActifs),
    supabase.from('aromatherapie_besoins').select('besoin_id, score, aromatherapie(*)').in('besoin_id', besoinsActifs),
    supabase.from('routines_besoins').select('besoin_id, score, routines(*)').in('besoin_id', besoinsActifs),
  ]);

  function deduper(rows: any[], key: string) {
    const map = new Map<string, any>();
    for (const row of rows || []) {
      const p = row[key];
      if (!p) continue;
      const existing = map.get(p.id);
      if (!existing || (existing.besoin_score || 0) < (row.score || 0)) {
        map.set(p.id, { ...p, besoin_score: row.score || 1 });
      }
    }
    return Array.from(map.values());
  }

  const nutraceutiques = deduper(resNutra.data || [], 'nutraceutiques')
    .sort((a: any, b: any) => (b.besoin_score || 0) - (a.besoin_score || 0))
    .slice(0, 1);
  const aromatherapie = deduper(resAro.data || [], 'aromatherapie')
    .sort((a: any, b: any) => (b.besoin_score || 0) - (a.besoin_score || 0))
    .slice(0, 1);
  const routines = deduper(resRoutines.data || [], 'routines')
    .sort((a: any, b: any) => (b.besoin_score || 0) - (a.besoin_score || 0))
    .slice(0, 1);

  return { nutraceutiques, aromatherapie, routines };
}

// ─── Génération motivation (inchangée, tourne en parallèle) ────────────────

async function genererMotivation(symptomes: string[]): Promise<{ message: string; conseil: string }> {
  const fallbackMessage = 'Votre plan de la semaine est prêt ! Chaque jour est une nouvelle opportunité de prendre soin de vous.';
  const fallbackConseil = 'Une alimentation colorée et variée est la base d\'une bonne santé — chaque couleur apporte des nutriments uniques.';

  if (!ANTHROPIC_API_KEY) return { message: fallbackMessage, conseil: fallbackConseil };

  try {
    const prompt = `En 2 phrases courtes et bienveillantes, donne :
1. Un message de motivation pour suivre un plan alimentaire hebdomadaire axé sur : ${symptomes.join(', ') || 'bien-être général'}
2. Un fait scientifique surprenant sur la nutrition lié à ces besoins

Format : JSON strict {"message": "...", "conseil": "..."}`;

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 250, temperature: 0.9, messages: [{ role: 'user', content: prompt }] }),
    });

    if (!response.ok) return { message: fallbackMessage, conseil: fallbackConseil };

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        message: parsed.message || fallbackMessage,
        conseil: parsed.conseil || fallbackConseil,
      };
    }
  } catch (_) {}

  return { message: fallbackMessage, conseil: fallbackConseil };
}

// ─── APPEL BATCH : 1 seul LLM pour les 21 squelettes ─────────────────────

interface RepasSquelette {
  nom: string;
  ingredients: string[];
  macros: { calories: number; proteines: number; glucides: number; lipides: number };
  temps_preparation?: number;
  temps_cuisson?: number;
}

interface JourSquelette {
  jour: string;
  petit_dejeuner: RepasSquelette;
  dejeuner: RepasSquelette;
  diner: RepasSquelette;
}

function validerRepasSquelette(repas: any): repas is RepasSquelette {
  return repas &&
    typeof repas.nom === 'string' && repas.nom.trim().length > 0 &&
    Array.isArray(repas.ingredients) && repas.ingredients.length >= 2 &&
    repas.macros &&
    typeof repas.macros.calories === 'number' &&
    typeof repas.macros.proteines === 'number';
}

function construirePromptBatch(
  pairesProteines: [string, string][],
  stylesJours: string[],
  profilNorm: any,
  symptomes: string[],
  repasInclus: string[] = ['petit_dejeuner', 'dejeuner', 'diner']
): string {
  const objectifMap: Record<string, string> = {
    vitalite: 'riche en fer, vitamines B et magnésium',
    serenite: 'riche en magnésium et tryptophane',
    digestion: 'riche en fibres et prébiotiques',
    sommeil: 'riche en tryptophane et mélatonine',
    mobilite: 'anti-inflammatoire, riche en oméga-3',
    hormones: 'riche en acides gras et phytoestrogènes',
  };
  const objectif = symptomes.length > 0
    ? symptomes.map(s => objectifMap[s]).filter(Boolean).join(' + ') || 'équilibrée et nutritive'
    : 'saine et équilibrée, sans objectif santé spécifique';

  const regimes = profilNorm.contraintesRegime.join(', ') || 'Aucune restriction';
  const allergenes = (profilNorm.allergenes || []).join(', ') || 'Aucun';
  const tempsMax = profilNorm.temps_preparation || 45;
  const budgetLabel = profilNorm.budget || '10-20 CHF par repas';
  const omnivore = !profilNorm.estVegan && !profilNorm.estVegetarien;

  // Tableau de planning imposé
  const lignesPlanning = pairesProteines.map(([pd, pn], i) => {
    const jour = JOURS_SEMAINE[i];
    const style = stylesJours[i];
    const proteines = omnivore
      ? `déjeuner=${pd} | dîner=${pn}`
      : `source végétale variée`;
    return `${jour.padEnd(9)} | ${style.padEnd(14)} | ${proteines}`;
  }).join('\n');

  const avecDejDin = repasInclus.includes('dejeuner') || repasInclus.includes('diner');

  // Contrainte protéine animale (seulement si déjeuner ou dîner inclus)
  const consigneProteine = avecDejDin
    ? (omnivore
        ? `\n**PROTÉINE ANIMALE** : Pour chaque déjeuner et dîner présents, utiliser EXACTEMENT la protéine indiquée dans le tableau. Elle doit figurer dans la liste d'ingrédients. Jamais 2 poissons le même jour.`
        : '\n**RÉGIME VÉGÉTAL** : Aucune viande ni poisson. Varier légumineuses, tofu, tempeh, œufs (si végétarien).')
    : '';

  const consigneSansLactose = profilNorm.estSansLactose
    ? '\n**SANS LACTOSE** : Aucun yaourt, fromage, lait animal, ricotta. Lait végétal uniquement.'
    : '';

  // Sections conditionnelles
  const sectionPetitDej = repasInclus.includes('petit_dejeuner') ? `
## CONTRAINTES PETIT-DÉJEUNER
- Saveur SUCRÉE uniquement (fruits, céréales, miel${profilNorm.estSansLactose ? '' : ', yaourt'})
- PAS de légumes, pas de recette salée
- Maximum 5 ingrédients
- Temps ≤ 10 minutes
` : '';

  const regleAntiRep = [
    repasInclus.includes('petit_dejeuner') ? '- Petit-déjeuner : base différente chaque jour parmi : smoothie bowl, porridge, overnight oats, tartine, crêpe, bol yaourt, granola bowl' : '',
    avecDejDin ? '- Déjeuner/Dîner : technique de cuisson différente chaque jour (poêlé, rôti, vapeur, mijoté, grillé, papillote, wok)' : '',
    '- Aucun ingrédient principal répété plus de 2 fois sur la semaine (hors huile d\'olive, sel, poivre)',
    '- Les noms de plats doivent tous être distincts et créatifs',
  ].filter(Boolean).join('\n');

  // Format JSON dynamique selon repas inclus
  const exemplePetitDej = repasInclus.includes('petit_dejeuner') ? `
      "petit_dejeuner": {
        "nom": "Nom créatif du plat",
        "ingredients": ["200g de flocons d'avoine", "1 banane mûre", "150ml de lait d'amande"],
        "macros": { "calories": 350, "proteines": 12, "glucides": 45, "lipides": 10 }
      },` : '';

  const exempleDejeuner = repasInclus.includes('dejeuner') ? `
      "dejeuner": {
        "nom": "Nom créatif du plat",
        "ingredients": ["160g de Saumon", "200g de courgette", "1 citron", "15ml d'huile d'olive"],
        "macros": { "calories": 450, "proteines": 30, "glucides": 35, "lipides": 18 },
        "temps_preparation": 10,
        "temps_cuisson": 6
      },` : '';

  const exempleDiner = repasInclus.includes('diner') ? `
      "diner": {
        "nom": "Nom créatif du plat",
        "ingredients": ["160g de Poulet", "150g de haricots verts", "2 gousses d'ail"],
        "macros": { "calories": 420, "proteines": 28, "glucides": 40, "lipides": 14 },
        "temps_preparation": 10,
        "temps_cuisson": 25
      }` : '';

  const macrosVisees = [
    repasInclus.includes('petit_dejeuner') ? 'petit-déjeuner ~350 kcal/12g prot' : '',
    repasInclus.includes('dejeuner') ? 'déjeuner ~480 kcal/30g prot' : '',
    repasInclus.includes('diner') ? 'dîner ~440 kcal/28g prot' : '',
  ].filter(Boolean).join(', ');

  return `Tu es un chef nutritionniste expert. Génère un plan alimentaire sur 7 jours.

## CONTRAINTES GLOBALES (NON NÉGOCIABLES)
- Régime : ${regimes}
- Allergènes à éviter absolument : ${allergenes}
- Objectif nutritionnel : ${objectif}
- Budget repas : ${budgetLabel}
- Temps de préparation max : ${tempsMax} minutes${consigneProteine}${consigneSansLactose}
- Repas à générer : ${repasInclus.filter(r => r !== 'pause').join(', ')}

## PLANNING IMPOSÉ (respecter style et protéines à la lettre)
Jour      | Style culinaire | Protéines
----------|-----------------|-----------------------------
${lignesPlanning}

## RÈGLES ANTI-RÉPÉTITION (OBLIGATOIRES)
${regleAntiRep}
${sectionPetitDej}
## FORMAT DE SORTIE : JSON strict uniquement, sans backticks, sans commentaire
{
  "jours": [
    {
      "jour": "lundi",${exemplePetitDej}${exempleDejeuner}${exempleDiner}
    }
    // ... 6 autres jours, même format
  ]
}

Macros visées : ${macrosVisees}.
Règles temps (cohérence obligatoire) :
- Poisson poêlé : temps_preparation=8, temps_cuisson=6
- Poulet rôti : temps_preparation=10, temps_cuisson=30
- Bœuf sauté wok : temps_preparation=10, temps_cuisson=8
- Légumes vapeur/mijotés : temps_preparation=10, temps_cuisson=20
- Salade/cru : temps_preparation=12, temps_cuisson=0
- Plat mijoté (tajine, curry) : temps_preparation=12, temps_cuisson=35
Réponds UNIQUEMENT avec le JSON, rien d'autre.`;
}

async function genererPlanBatch(
  pairesProteines: [string, string][],
  stylesJours: string[],
  profilNorm: any,
  symptomes: string[],
  repasInclus: string[] = ['petit_dejeuner', 'dejeuner', 'diner', 'pause']
): Promise<JourSquelette[] | null> {
  if (!ANTHROPIC_API_KEY) return null;

  const repasLLM = repasInclus.filter(r => r !== 'pause'); // pause = statique, pas LLM
  const prompt = construirePromptBatch(pairesProteines, stylesJours, profilNorm, symptomes, repasLLM);

  // 2 tentatives avec backoff sur 429/5xx
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: 8000,
          temperature: 0.8,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (response.status === 429 || response.status >= 500) {
        const waitMs = attempt === 0 ? 8000 : 15000;
        console.warn(`[BATCH] HTTP ${response.status} (tentative ${attempt + 1}/2) — attente ${waitMs / 1000}s...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      if (!response.ok) {
        const errTxt = await response.text();
        console.error(`[BATCH] HTTP ${response.status} — ${errTxt.substring(0, 300)}`);
        return null;
      }

      const data = await response.json();
      const text = data.content?.[0]?.text || '';

      // Extraction JSON : chercher le premier { ... } valide
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('[BATCH] Pas de JSON détecté dans la réponse');
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const jours: JourSquelette[] = parsed?.jours;

      if (!Array.isArray(jours) || jours.length < 7) {
        console.error(`[BATCH] Structure invalide : ${jours?.length ?? 0} jours reçus`);
        return null;
      }

      console.log(`[BATCH] ${jours.length} jours reçus du LLM`);
      return jours;

    } catch (error) {
      console.error('[BATCH] Exception:', error);
      return null;
    }
  }

  return null;
}

// ─── Transformation squelette → repas complet ──────────────────────────────

function squelettVersRepas(
  repasRaw: any,
  typeRepas: string,
  styleCulinaire: string,
  proteineAssignee: string | null,
  jourIndex: number
): any {
  // Validation : si invalide → fallback unitaire
  if (!validerRepasSquelette(repasRaw)) {
    console.warn(`[BATCH] Repas invalide (${typeRepas}, jour ${jourIndex + 1}) → fallback`);
    return recetteFallbackUnitaire(typeRepas, proteineAssignee, styleCulinaire, jourIndex);
  }

  // Ingredients : le batch retourne des strings, on les garde tels quels
  const ingredients = (repasRaw.ingredients as string[]).map((ing: string) => {
    // Tenter de parser "200g de Saumon" → { nom, quantite, unite }
    const match = ing.match(/^(\d+(?:[.,]\d+)?)\s*(g|ml|kg|L|cl|pièces?|tranches?|c\.?à[. ]s\.?|c\.?à[. ]c\.?)\s+(?:de\s+)?(.+)$/i);
    if (match) {
      return {
        nom: match[3].trim(),
        quantite: parseFloat(match[1].replace(',', '.')),
        unite: match[2],
      };
    }
    return { nom: ing.trim(), quantite: 1, unite: 'portion' };
  });

  return {
    nom: repasRaw.nom.trim(),
    type_repas: typeRepas,
    style_culinaire: styleCulinaire,
    ingredients,
    instructions: repasRaw.instructions || [],
    temps_preparation: (repasRaw.temps_preparation && repasRaw.temps_preparation > 0)
      ? repasRaw.temps_preparation
      : (typeRepas === 'petit-dejeuner' ? 10 : 15),
    temps_cuisson: repasRaw.temps_cuisson ?? (typeRepas === 'petit-dejeuner' ? 0 : 20),
    portions: typeRepas === 'petit-dejeuner' ? 1 : 2,
    valeurs_nutritionnelles: {
      calories: repasRaw.macros.calories || 0,
      proteines: repasRaw.macros.proteines || 0,
      glucides: repasRaw.macros.glucides || 0,
      lipides: repasRaw.macros.lipides || 0,
    },
    astuces: [],
    variantes: [],
    genere_par_llm: true,
  };
}

// ─── Cache : lecture et écriture ───────────────────────────────────────────

async function lireCachePlan(supabase: any, profilId: string): Promise<any | null> {
  try {
    const { data, error } = await supabase
      .from('plans_generes_cache')
      .select('plan_json, created_at, symptomes')
      .eq('profil_id', profilId)
      .eq('source', 'semaine')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn('[CACHE] Erreur lecture cache:', error.message);
      return null;
    }

    if (data?.plan_json) {
      console.log(`[CACHE] Plan trouvé — généré le ${data.created_at}`);
      return data.plan_json;
    }

    return null;
  } catch (e) {
    console.warn('[CACHE] Exception lecture cache:', e);
    return null;
  }
}

async function ecrireCachePlan(
  supabase: any,
  profilId: string,
  symptomes: string[],
  planJson: any
): Promise<void> {
  const { error } = await supabase
    .from('plans_generes_cache')
    .upsert(
      {
        profil_id: profilId,
        source: 'semaine',
        symptomes,
        plan_json: planJson,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      { onConflict: 'profil_id,source' }
    );
  if (error) {
    console.error('[CACHE] Erreur upsert plan semaine:', error.message, error.code);
  } else {
    console.log('[CACHE] Plan semaine sauvegardé (upsert ok)');
  }
}

// ─── Handler principal ─────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const { profil_id, symptomes, force_refresh = false, repas_inclus } = body;
    const repasInclus: string[] = Array.isArray(repas_inclus) && repas_inclus.length > 0
      ? repas_inclus
      : ['petit_dejeuner', 'dejeuner', 'diner', 'pause'];

    if (!profil_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'profil_id requis' }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const symptomesArr: string[] = Array.isArray(symptomes) ? symptomes : [];
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── 1. LECTURE CACHE ──────────────────────────────────────────────────
    try {
      const { data: cachedRow } = await supabase
        .from('plans_generes_cache')
        .select('plan_json, created_at')
        .eq('profil_id', profil_id)
        .eq('source', 'semaine')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cachedRow?.plan_json && !force_refresh) {
        console.log('[generer-plan-semaine] Retour depuis le cache');
        return new Response(
          JSON.stringify({ ...cachedRow.plan_json, _source: 'cache' }),
          { status: 200, headers: CORS_HEADERS }
        );
      }
    } catch (cacheErr) {
      console.warn('[CACHE] Lecture cache semaine échouée (non bloquant):', cacheErr);
    }

    // ── RATE LIMITING : 10 générations/heure, re-génération immédiate possible ──
    if (!checkPlanRateLimit(profil_id)) {
      console.warn(`[RATE LIMIT] profil ${profil_id} a dépassé ${PLAN_RATE_LIMIT_MAX} générations/heure`);
      return new Response(
        JSON.stringify({ success: false, error: 'Limite atteinte : 10 plans maximum par heure.' }),
        { status: 429, headers: CORS_HEADERS }
      );
    }

    // ── 2. CHARGEMENT PROFIL ───────────────────────────────────────────────
    const { data: profils } = await supabase
      .from('profils_utilisateurs')
      .select('*')
      .eq('id', profil_id)
      .limit(1);

    const profil = profils?.[0] || {};

    const budgetRepasMap: Record<string, string> = {
      faible: '< 10 CHF par repas',
      moyen:  '10-20 CHF par repas',
      eleve:  '> 20 CHF par repas',
    };

    const profilNorm = {
      regime_alimentaire: normaliserArray(profil.regimes_alimentaires || profil.regime_alimentaire),
      allergenes: normaliserArray(profil.allergies || profil.allergenes),
      temps_preparation: profil.temps_cuisine_max || profil.temps_preparation || 45,
      budget: budgetRepasMap[profil.budget_complements || profil.budget || 'moyen'] || '10-20 CHF par repas',
      estVegan: normaliserArray(profil.regimes_alimentaires || profil.regime_alimentaire)
        .some((r: string) => ['vegan', 'végétalien'].includes(r.toLowerCase())),
      estVegetarien: normaliserArray(profil.regimes_alimentaires || profil.regime_alimentaire)
        .some((r: string) => ['vegetarien', 'végétarien'].includes(r.toLowerCase())),
      estSansLactose: normaliserArray(profil.allergies || profil.allergenes).includes('lactose') ||
        normaliserArray(profil.regimes_alimentaires || profil.regime_alimentaire)
          .some((r: string) => ['sans_lactose', 'sans-lactose'].includes(r.toLowerCase())),
      contraintesRegime: [] as string[],
    };

    if (profilNorm.estVegan) profilNorm.contraintesRegime.push('100% VEGANE');
    else if (profilNorm.estVegetarien) profilNorm.contraintesRegime.push('VÉGÉTARIENNE');
    if (profilNorm.estSansLactose) profilNorm.contraintesRegime.push('SANS LACTOSE');
    if (normaliserArray(profil.allergies || []).includes('gluten') ||
        normaliserArray(profil.regimes_alimentaires || []).includes('sans-gluten'))
      profilNorm.contraintesRegime.push('SANS GLUTEN');

    console.log(`[generer-plan-semaine] GÉNÉRATION profil=${profil_id}, force=${force_refresh}, symptomes=${symptomesArr.join(',')}`);

    // ── 3. PRÉPARATION PROTÉINES ET STYLES ────────────────────────────────
    const aliments = await chargerAliments(supabase, symptomesArr, profilNorm);

    let proteinesDisponibles: string[] = [];
    if (!profilNorm.estVegan && !profilNorm.estVegetarien) {
      proteinesDisponibles = aliments
        .filter(a => estViandePoissonCrustace(a.categorie || ''))
        .sort((a: any, b: any) => (b.besoin_score || 0) - (a.besoin_score || 0))
        .map(a => a.nom);
    } else {
      proteinesDisponibles = aliments
        .filter(a => {
          const cat = (a.categorie || '').toLowerCase();
          return cat.includes('légumineus') || cat.includes('legumineus') ||
            cat.includes('tofu') || cat.includes('tempeh') || cat.includes('soja');
        })
        .map(a => a.nom);
    }

    const proteinesUniques = [...new Set(proteinesDisponibles)];
    const proteinesPool = proteinesUniques.length >= 7
      ? shuffleArray(proteinesUniques)
      : shuffleArray([...proteinesUniques, 'Poulet', 'Saumon', 'Boeuf', 'Thon', 'Crevettes', 'Dinde', 'Maquereau']
          .filter((v, i, a) => a.indexOf(v) === i));

    // Paires protéines : 2 par jour, jamais 2 poissons le même jour
    const pairesProteines: [string, string][] = [];
    const proteinesShuffled = shuffleArray(proteinesPool);
    let idx = 0;
    for (let j = 0; j < 7; j++) {
      const prot1 = proteinesShuffled[idx % proteinesShuffled.length]; idx++;
      let prot2 = proteinesShuffled[idx % proteinesShuffled.length];
      if (estPoisson(prot1) && estPoisson(prot2)) {
        const nonPoissons = proteinesShuffled.filter(p => !estPoisson(p));
        prot2 = nonPoissons.length > 0 ? nonPoissons[idx % nonPoissons.length] : prot2;
      }
      idx++;
      pairesProteines.push([prot1, prot2]);
    }

    const stylesJours = shuffleArray([...STYLES_CULINAIRES]).slice(0, 7);

    // ── 4. APPELS EN PARALLÈLE : batch LLM + wellness + motivation ─────────
    const [joursLLM, wellness, motivation] = await Promise.all([
      genererPlanBatch(pairesProteines, stylesJours, profilNorm, symptomesArr, repasInclus),
      chargerWellness(supabase, symptomesArr),
      genererMotivation(symptomesArr),
    ]);

    // ── 5. CONSTRUCTION SEMAINE (LLM ou fallback complet) ─────────────────
    let semaine: Record<string, any>;
    let llmCount = 0;
    let fallbackCount = 0;

    if (joursLLM && joursLLM.length >= 7) {
      semaine = {};
      for (let j = 0; j < 7; j++) {
        const jour = JOURS_SEMAINE[j];
        const style = stylesJours[j];
        const [protDej, protDin] = pairesProteines[j];
        const jourRaw = joursLLM[j];

        const petitDej = squelettVersRepas(jourRaw?.petit_dejeuner, 'petit-dejeuner', style, null, j);
        const dejeuner = squelettVersRepas(jourRaw?.dejeuner, 'dejeuner', style, protDej, j);
        const diner = squelettVersRepas(jourRaw?.diner, 'diner', style, protDin, j);

        if (petitDej.genere_par_llm) llmCount++; else fallbackCount++;
        if (dejeuner.genere_par_llm) llmCount++; else fallbackCount++;
        if (diner.genere_par_llm) llmCount++; else fallbackCount++;

        semaine[jour] = {
          ...(repasInclus.includes('petit_dejeuner') ? { petit_dejeuner: petitDej } : {}),
          ...(repasInclus.includes('dejeuner')       ? { dejeuner: dejeuner }       : {}),
          ...(repasInclus.includes('diner')          ? { diner: diner }             : {}),
          ...(repasInclus.includes('pause')          ? { pause: collationParDefaut(profilNorm, j) } : {}),
        };
      }
      console.log(`[STATS] LLM=${llmCount}/21 | Fallback=${fallbackCount}/21`);
    } else {
      console.warn('[generer-plan-semaine] Batch LLM échoué → fallback semaine complet');
      semaine = fallbackSemaine(pairesProteines, stylesJours, profilNorm);
      fallbackCount = 21;
    }

    // ── 6. RÉPONSE FINALE ─────────────────────────────────────────────────
    const reponse = {
      success: true,
      semaine,
      nutraceutiques: wellness.nutraceutiques,
      aromatherapie: wellness.aromatherapie,
      routines: wellness.routines,
      message_motivation: motivation.message,
      conseil_du_jour: motivation.conseil,
      _stats: { llm: llmCount, fallback: fallbackCount, total: 21, mode: 'batch_v2' },
      _source: 'generated',
    };

    // ── 7. SAUVEGARDE CACHE (await obligatoire — Deno coupe les promesses en suspend) ──
    await ecrireCachePlan(supabase, profil_id, symptomesArr, reponse);

    return new Response(
      JSON.stringify(reponse),
      { status: 200, headers: CORS_HEADERS }
    );

  } catch (error: any) {
    console.error('[ERROR] Exception principale:', error);
    return new Response(
      JSON.stringify({ success: false, error: error?.message || 'Erreur inconnue' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
});

// supabase/functions/generer-plan/types.ts

export interface ProfilUtilisateur {
  id: string;
  age?: number;
  sexe?: 'M' | 'F' | 'Autre';
  poids?: number;
  taille?: number;
  
  // Conditions médicales
  grossesse?: boolean;
  allaitement?: boolean;
  pathologies?: string[];
  medications?: string[];
  
  // Régimes & allergies
  regime_alimentaire?: string[]; // ['vegan', 'halal', 'casher', 'sans-gluten','vegetarien','paleo','keto']
  allergenes?: string[]; // ['gluten', 'lactose', 'noix']
  groupe_sanguin?: string;
  
  // Préférences
  budget?: 'faible' | 'moyen' | 'eleve';
  temps_preparation?: number; // minutes
  styles_cuisines_favoris?: string[];
  styles_cuisines_exclus?: string[];
  niveau_variete?: 'faible' | 'moyenne' | 'elevee';
}

export interface ContexteUtilisateur {
  symptomes_declares?: string[]; // besoins IDs: ['vitalite', 'serenite', ...]
  intensites?: Record<string, number>;
  objectif_principal?: string; // besoin principal
  duree_symptomes?: string;
}

export interface ProduitFiltre {
  id: string;
  nom: string;
  type: 'nutraceutique' | 'aromatherapie' | 'aliment';
  categorie?: string;
  symptomes_cibles: string[];
  niveau_preuve: number;
  efficacite_estimee: number;
  score_pertinence?: number;
  score_rotation?: number;
  besoin_score?: number;  // score issu de la table junction (1-5)
  besoin_id?: string;     // besoin principal ciblé
}

export interface RecetteCandidate {
  id: string;
  nom?: string;
  type_repas: 'petit-dejeuner' | 'dejeuner' | 'diner' | 'collation';
  style_culinaire?: string;
  ingredients_ids: string[];
  ingredients_principaux?: string[];
  temps_total?: number;
  score_pertinence?: number;
  score_rotation?: number;
}

export interface RoutineCandidate {
  id: string;
  nom: string;
  categorie: string;
  symptomes_cibles: string[];
  duree_quotidienne: string;
  moment_optimal?: string;
  score_pertinence?: number;
  score_rotation?: number;
}

export interface ItemVu {
  item_id: string;
  type_item: string;
  nb_vues: number;
  derniere_vue: string;
  score_rotation: number;
}

export interface PlanGenere {
  id?: string;
  profil_id: string;
  objectif: string;
  symptomes: string[];

  petit_dejeuner: RecetteGeneree;
  dejeuner: RecetteGeneree;
  diner: RecetteGeneree;
  pause?: any; // Collation 15h30 — recette simple sans compléments
  collations?: RecetteGeneree[];
  
  nutraceutiques: ProduitRecommande[];
  aromatherapie?: ProduitRecommande[];
  routines: RoutineRecommandee[];
  
  message_motivation?: string;
  conseil_du_jour?: string;
  conseils_generaux?: string[];
  
  genere_le: string;
  expire_le?: string;
}

export interface RecetteGeneree {
  id?: string;
  nom: string;
  type_repas: string;
  style_culinaire: string;
  ingredients: Ingredient[];
  instructions: string[];
  temps_preparation: number;
  temps_cuisson: number;
  portions: number;
  valeurs_nutritionnelles?: ValeursNutritionnelles;
  astuces?: string[];
  variantes?: string[];
  genere_par_llm: boolean;
}

export interface Ingredient {
  id?: string;
  nom: string;
  quantite: number;
  unite: string;
}

export interface ValeursNutritionnelles {
  calories: number;
  proteines: number;
  glucides: number;
  lipides: number;
}

export interface ProduitRecommande {
  id: string;
  nom: string;
  type: string;
  dosage: string;
  timing: string;
  moment_optimal?: string;
  raison: string;
  niveau_preuve: number;
}

export interface RoutineRecommandee {
  id: string;
  nom: string;
  categorie: string;
  duree: string;
  moment: string;
  protocole: string;
  raison: string;
}

export interface HistoriqueRotation {
  items_frequents: ItemVu[];
  styles_recents: { style: string; score: number }[];
  ingredients_recents: string[];
}

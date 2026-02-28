-- ============================================================
-- MIGRATION : Mise à jour complète des tables de correspondance
-- Scores différenciés (3/4/5) basés sur pertinence médicale réelle
-- 5 = bénéfice majeur/primaire | 4 = bon | 3 = modéré
-- Seules les associations >= 3 sont stockées
-- ============================================================

-- ============================================================
-- 1. NUTRACEUTIQUES_BESOINS
-- ============================================================
TRUNCATE nutraceutiques_besoins;

INSERT INTO nutraceutiques_besoins (nutraceutique_id, besoin_id, score) VALUES
-- NUT_001 Magnésium
('NUT_001','vitalite',4),('NUT_001','serenite',5),('NUT_001','sommeil',5),('NUT_001','digestion',3),('NUT_001','mobilite',3),('NUT_001','hormones',3),
-- NUT_002 Vitamine D
('NUT_002','vitalite',4),('NUT_002','serenite',3),('NUT_002','sommeil',3),('NUT_002','mobilite',4),('NUT_002','hormones',5),
-- NUT_003 Magnésium (premium)
('NUT_003','vitalite',4),('NUT_003','serenite',5),('NUT_003','sommeil',5),('NUT_003','digestion',3),('NUT_003','mobilite',3),('NUT_003','hormones',3),
-- NUT_004 Vitamine D (premium)
('NUT_004','vitalite',4),('NUT_004','serenite',3),('NUT_004','sommeil',3),('NUT_004','mobilite',4),('NUT_004','hormones',5),
-- NUT_005 Vitamine C
('NUT_005','vitalite',5),('NUT_005','serenite',3),('NUT_005','digestion',3),('NUT_005','mobilite',4),('NUT_005','hormones',3),
-- NUT_006 Zinc
('NUT_006','vitalite',4),('NUT_006','serenite',3),('NUT_006','sommeil',3),('NUT_006','digestion',3),('NUT_006','mobilite',3),('NUT_006','hormones',5),
-- NUT_007 Oméga-3
('NUT_007','vitalite',4),('NUT_007','serenite',4),('NUT_007','sommeil',3),('NUT_007','digestion',3),('NUT_007','mobilite',5),('NUT_007','hormones',4),
-- NUT_008 Probiotiques
('NUT_008','vitalite',3),('NUT_008','serenite',4),('NUT_008','sommeil',3),('NUT_008','digestion',5),('NUT_008','mobilite',3),('NUT_008','hormones',3),
-- NUT_009 Rhodiola
('NUT_009','vitalite',5),('NUT_009','serenite',4),('NUT_009','sommeil',3),('NUT_009','mobilite',3),('NUT_009','hormones',3),
-- NUT_010 Ashwagandha
('NUT_010','vitalite',4),('NUT_010','serenite',5),('NUT_010','sommeil',4),('NUT_010','mobilite',3),('NUT_010','hormones',5),
-- NUT_011 Bacopa
('NUT_011','vitalite',3),('NUT_011','serenite',4),('NUT_011','sommeil',3),
-- NUT_012 L-théanine
('NUT_012','vitalite',3),('NUT_012','serenite',5),('NUT_012','sommeil',4),
-- NUT_013 Mélatonine
('NUT_013','serenite',3),('NUT_013','sommeil',5),('NUT_013','hormones',4),
-- NUT_014 CoQ10
('NUT_014','vitalite',5),('NUT_014','mobilite',4),('NUT_014','hormones',3),
-- NUT_016 Collagène Marin
('NUT_016','vitalite',3),('NUT_016','digestion',3),('NUT_016','mobilite',5),('NUT_016','hormones',3),
-- NUT_017 Fer
('NUT_017','vitalite',5),('NUT_017','sommeil',3),('NUT_017','mobilite',3),('NUT_017','hormones',3),
-- NUT_018 Magnésium Bisglycinate
('NUT_018','vitalite',4),('NUT_018','serenite',5),('NUT_018','sommeil',5),('NUT_018','digestion',3),('NUT_018','mobilite',3),('NUT_018','hormones',3),
-- NUT_019 Vitamine D3+K2
('NUT_019','vitalite',4),('NUT_019','serenite',3),('NUT_019','sommeil',3),('NUT_019','mobilite',5),('NUT_019','hormones',5),
-- NUT_020 Oméga-3 huile poisson
('NUT_020','vitalite',4),('NUT_020','serenite',4),('NUT_020','sommeil',3),('NUT_020','digestion',3),('NUT_020','mobilite',5),('NUT_020','hormones',4),
-- NUT_021 Probiotiques (autre)
('NUT_021','vitalite',3),('NUT_021','serenite',4),('NUT_021','sommeil',3),('NUT_021','digestion',5),('NUT_021','mobilite',3),('NUT_021','hormones',3),
-- NUT_022 Vitamine C Liposomale
('NUT_022','vitalite',5),('NUT_022','serenite',3),('NUT_022','digestion',3),('NUT_022','mobilite',4),('NUT_022','hormones',3),
-- NUT_023 Curcumine optimisée
('NUT_023','vitalite',3),('NUT_023','serenite',3),('NUT_023','digestion',4),('NUT_023','mobilite',5),('NUT_023','hormones',3),
-- NUT_024 Berbérine
('NUT_024','vitalite',3),('NUT_024','digestion',5),('NUT_024','mobilite',3),('NUT_024','hormones',4),
-- NUT_025 L-Glutamine
('NUT_025','vitalite',3),('NUT_025','digestion',5),('NUT_025','mobilite',3),('NUT_025','hormones',3);

-- ============================================================
-- 2. AROMATHERAPIE_BESOINS
-- ============================================================
TRUNCATE aromatherapie_besoins;

INSERT INTO aromatherapie_besoins (aromatherapie_id, besoin_id, score) VALUES
-- ARO_001 Lavande vraie
('ARO_001','serenite',5),('ARO_001','sommeil',5),('ARO_001','digestion',3),('ARO_001','mobilite',3),('ARO_001','hormones',3),
-- ARO_002 Tea Tree
('ARO_002','vitalite',3),('ARO_002','digestion',3),('ARO_002','mobilite',3),
-- ARO_003 Lavande Vraie (doublon)
('ARO_003','serenite',5),('ARO_003','sommeil',5),('ARO_003','digestion',3),('ARO_003','mobilite',3),('ARO_003','hormones',3),
-- ARO_004 Menthe Poivrée
('ARO_004','vitalite',4),('ARO_004','serenite',3),('ARO_004','digestion',5),('ARO_004','mobilite',4),
-- ARO_005 Ravintsara
('ARO_005','vitalite',5),('ARO_005','serenite',3),('ARO_005','sommeil',3),('ARO_005','mobilite',3),
-- ARO_006 Tea Tree (doublon)
('ARO_006','vitalite',3),('ARO_006','digestion',3),('ARO_006','mobilite',3),
-- ARO_007 Citron
('ARO_007','vitalite',4),('ARO_007','serenite',4),('ARO_007','digestion',4),('ARO_007','mobilite',3),('ARO_007','hormones',3),
-- ARO_008 Eucalyptus Radiata
('ARO_008','vitalite',4),('ARO_008','serenite',3),('ARO_008','sommeil',3),('ARO_008','mobilite',3),
-- ARO_009 Ylang-Ylang
('ARO_009','serenite',5),('ARO_009','sommeil',4),('ARO_009','hormones',5),
-- ARO_010 Gaulthérie
('ARO_010','mobilite',5),
-- ARO_011 Hélichryse Italienne
('ARO_011','serenite',3),('ARO_011','mobilite',5),
-- ARO_012 Laurier Noble
('ARO_012','vitalite',4),('ARO_012','serenite',4),('ARO_012','sommeil',3),('ARO_012','digestion',3),('ARO_012','mobilite',3),('ARO_012','hormones',3),
-- ARO_013 Camomille romaine
('ARO_013','serenite',5),('ARO_013','sommeil',5),('ARO_013','digestion',4),('ARO_013','mobilite',3),('ARO_013','hormones',3),
-- ARO_014 Encens Oliban
('ARO_014','vitalite',3),('ARO_014','serenite',5),('ARO_014','sommeil',4),('ARO_014','mobilite',4),('ARO_014','hormones',3),
-- ARO_015 Géranium rosat
('ARO_015','vitalite',3),('ARO_015','serenite',4),('ARO_015','sommeil',3),('ARO_015','mobilite',3),('ARO_015','hormones',5),
-- ARO_016 Petit Grain Bigarade
('ARO_016','serenite',5),('ARO_016','sommeil',4),('ARO_016','digestion',3),('ARO_016','hormones',3),
-- ARO_017 Romarin
('ARO_017','vitalite',5),('ARO_017','digestion',3),('ARO_017','mobilite',3),('ARO_017','hormones',3),
-- ARO_018 Citronnelle
('ARO_018','vitalite',3),('ARO_018','serenite',3),('ARO_018','sommeil',3),('ARO_018','digestion',3),('ARO_018','mobilite',4),
-- ARO_019 Bois de Hô
('ARO_019','vitalite',3),('ARO_019','serenite',4),('ARO_019','sommeil',4),
-- ARO_020 Pin Sylvestre
('ARO_020','vitalite',4),('ARO_020','serenite',3),('ARO_020','mobilite',3),('ARO_020','hormones',3),
-- ARO_021 Cannelle Écorce
('ARO_021','vitalite',3),('ARO_021','digestion',4),('ARO_021','mobilite',3),('ARO_021','hormones',4),
-- ARO_022 Clou de Girofle
('ARO_022','vitalite',3),('ARO_022','digestion',4),('ARO_022','mobilite',3),
-- ARO_023 Genièvre
('ARO_023','serenite',3),('ARO_023','digestion',4),('ARO_023','mobilite',4),
-- ARO_024 Marjolaine à Coquilles
('ARO_024','vitalite',3),('ARO_024','serenite',5),('ARO_024','sommeil',5),('ARO_024','digestion',3),('ARO_024','hormones',3),
-- ARO_025 Palmarosa
('ARO_025','serenite',3),('ARO_025','sommeil',3),('ARO_025','digestion',3),('ARO_025','mobilite',3),('ARO_025','hormones',4),
-- ARO_026 Vétiver
('ARO_026','serenite',5),('ARO_026','sommeil',5),('ARO_026','hormones',3),
-- ARO_027 Patchouli
('ARO_027','serenite',4),('ARO_027','sommeil',3),('ARO_027','digestion',3),('ARO_027','hormones',4),
-- ARO_028 Niaouli
('ARO_028','vitalite',5),('ARO_028','mobilite',3),
-- ARO_029 Bergamote
('ARO_029','vitalite',3),('ARO_029','serenite',5),('ARO_029','sommeil',4),('ARO_029','hormones',3),
-- ARO_030 Orange Douce
('ARO_030','vitalite',3),('ARO_030','serenite',4),('ARO_030','sommeil',4),('ARO_030','digestion',3),
-- ARO_031 Mandarine Verte
('ARO_031','serenite',4),('ARO_031','sommeil',4),('ARO_031','digestion',3),
-- ARO_032 Sauge Sclarée
('ARO_032','serenite',4),('ARO_032','sommeil',3),('ARO_032','hormones',5),
-- ARO_033 Mélisse
('ARO_033','vitalite',3),('ARO_033','serenite',5),('ARO_033','sommeil',5),('ARO_033','digestion',4),
-- ARO_034 Nard de l'Himalaya
('ARO_034','serenite',4),('ARO_034','sommeil',5),('ARO_034','hormones',3),
-- ARO_035 Litsée Citronnée
('ARO_035','vitalite',3),('ARO_035','serenite',4),('ARO_035','sommeil',3),
-- ARO_036 Eucalyptus Globulus
('ARO_036','vitalite',4),('ARO_036','mobilite',3),
-- ARO_037 Origan Compact
('ARO_037','vitalite',3),('ARO_037','digestion',4),('ARO_037','mobilite',3),
-- ARO_038 Thym à Linalol
('ARO_038','vitalite',4),('ARO_038','digestion',3),('ARO_038','mobilite',3),
-- ARO_039 Sarriette des montagnes
('ARO_039','vitalite',3),('ARO_039','digestion',3),('ARO_039','mobilite',3),('ARO_039','hormones',3),
-- ARO_040 Inule Odorante
('ARO_040','vitalite',4),('ARO_040','digestion',4),('ARO_040','mobilite',4),
-- ARO_041 Manuka
('ARO_041','vitalite',3),('ARO_041','digestion',4),('ARO_041','mobilite',3),
-- ARO_042 Basilic Exotique
('ARO_042','vitalite',3),('ARO_042','serenite',4),('ARO_042','sommeil',3),('ARO_042','digestion',5),('ARO_042','mobilite',3),
-- ARO_043 Cardamome
('ARO_043','vitalite',3),('ARO_043','serenite',3),('ARO_043','digestion',5),('ARO_043','hormones',3),
-- ARO_044 Estragon
('ARO_044','serenite',3),('ARO_044','digestion',5),('ARO_044','mobilite',3),
-- ARO_045 Rose de Damas
('ARO_045','vitalite',3),('ARO_045','serenite',5),('ARO_045','sommeil',4),('ARO_045','hormones',5),
-- ARO_046 Cèdre de l'Atlas
('ARO_046','vitalite',3),('ARO_046','serenite',4),('ARO_046','sommeil',4),('ARO_046','hormones',3),
-- ARO_047 Hydrolat Menthe Poivrée
('ARO_047','vitalite',3),('ARO_047','digestion',4),('ARO_047','mobilite',3),
-- ARO_048 Hydrolat Rose
('ARO_048','serenite',5),('ARO_048','sommeil',3),('ARO_048','hormones',5),
-- ARO_049 Hydrolat Hamamélis
('ARO_049','serenite',3),('ARO_049','mobilite',4),
-- ARO_050 Hydrolat Fleur d'Oranger
('ARO_050','serenite',5),('ARO_050','sommeil',5),('ARO_050','hormones',3);

-- ============================================================
-- 3. ROUTINES_BESOINS
-- ============================================================
TRUNCATE routines_besoins;

INSERT INTO routines_besoins (routine_id, besoin_id, score) VALUES
-- ROU_001 Cohérence cardiaque
('ROU_001','vitalite',3),('ROU_001','serenite',5),('ROU_001','sommeil',4),('ROU_001','mobilite',4),('ROU_001','hormones',3),
-- ROU_002 Cohérence cardiaque (v2)
('ROU_002','vitalite',3),('ROU_002','serenite',5),('ROU_002','sommeil',4),('ROU_002','mobilite',4),('ROU_002','hormones',3),
-- ROU_003 Méditation mindfulness
('ROU_003','serenite',5),('ROU_003','sommeil',4),('ROU_003','digestion',3),('ROU_003','mobilite',3),('ROU_003','hormones',3),
-- ROU_004 Yoga du matin
('ROU_004','vitalite',4),('ROU_004','serenite',4),('ROU_004','sommeil',3),('ROU_004','digestion',3),('ROU_004','mobilite',4),('ROU_004','hormones',3),
-- ROU_005 Marche en nature
('ROU_005','vitalite',5),('ROU_005','serenite',4),('ROU_005','sommeil',3),('ROU_005','digestion',3),('ROU_005','mobilite',4),('ROU_005','hormones',3),
-- ROU_006 Hygiène du sommeil
('ROU_006','vitalite',3),('ROU_006','serenite',4),('ROU_006','sommeil',5),('ROU_006','hormones',4),
-- ROU_007 Douche froide
('ROU_007','vitalite',5),('ROU_007','serenite',3),('ROU_007','mobilite',3),('ROU_007','hormones',4),
-- ROU_008 Journaling
('ROU_008','serenite',5),('ROU_008','sommeil',3),
-- ROU_009 Exposition soleil matinale
('ROU_009','vitalite',5),('ROU_009','serenite',3),('ROU_009','sommeil',4),('ROU_009','mobilite',3),('ROU_009','hormones',5),
-- ROU_010 Étirements quotidiens
('ROU_010','vitalite',3),('ROU_010','serenite',3),('ROU_010','sommeil',3),('ROU_010','mobilite',5),
-- ROU_011 Respiration 4-7-8
('ROU_011','serenite',5),('ROU_011','sommeil',5),
-- ROU_012 Hydratation matinale
('ROU_012','vitalite',4),('ROU_012','digestion',4),('ROU_012','mobilite',3),('ROU_012','hormones',3),
-- ROU_013 Marche Quotidienne
('ROU_013','vitalite',5),('ROU_013','serenite',3),('ROU_013','sommeil',3),('ROU_013','digestion',3),('ROU_013','mobilite',4),('ROU_013','hormones',3),
-- ROU_014 Digital Detox
('ROU_014','vitalite',3),('ROU_014','serenite',4),('ROU_014','sommeil',4),
-- ROU_015 Douche Écossaise
('ROU_015','vitalite',5),('ROU_015','serenite',3),('ROU_015','mobilite',4),('ROU_015','hormones',4),
-- ROU_016 Jeûne Intermittent
('ROU_016','vitalite',4),('ROU_016','sommeil',3),('ROU_016','digestion',5),('ROU_016','mobilite',3),('ROU_016','hormones',4),
-- ROU_017 Grounding (Earthing)
('ROU_017','vitalite',3),('ROU_017','serenite',4),('ROU_017','sommeil',3),('ROU_017','mobilite',3),
-- ROU_018 Lunettes anti-lumière bleue
('ROU_018','serenite',3),('ROU_018','sommeil',5),('ROU_018','hormones',4),
-- ROU_019 Brossage à sec
('ROU_019','vitalite',3),('ROU_019','serenite',3),('ROU_019','digestion',4),('ROU_019','mobilite',4),
-- ROU_020 Oil Pulling
('ROU_020','vitalite',3),('ROU_020','digestion',3),
-- ROU_021 Sauna infrarouge
('ROU_021','vitalite',4),('ROU_021','serenite',3),('ROU_021','sommeil',4),('ROU_021','digestion',3),('ROU_021','mobilite',5),('ROU_021','hormones',3),
-- ROU_022 Sieste flash
('ROU_022','vitalite',4),('ROU_022','serenite',3),('ROU_022','sommeil',4),
-- ROU_023 Yoga Nidra
('ROU_023','vitalite',3),('ROU_023','serenite',4),('ROU_023','sommeil',5),('ROU_023','hormones',3),
-- ROU_024 Lumière rouge
('ROU_024','vitalite',4),('ROU_024','serenite',3),('ROU_024','sommeil',4),('ROU_024','mobilite',4),('ROU_024','hormones',4),
-- ROU_025 Respiration Wim Hof
('ROU_025','vitalite',5),('ROU_025','serenite',3),('ROU_025','mobilite',3),('ROU_025','hormones',4),
-- ROU_026 Massage cuir chevelu
('ROU_026','serenite',4),('ROU_026','sommeil',3),('ROU_026','hormones',3),
-- ROU_027 Auto-massage Gua Sha
('ROU_027','serenite',3),('ROU_027','sommeil',3),('ROU_027','mobilite',4),('ROU_027','hormones',3),
-- ROU_028 Affirmations positives
('ROU_028','serenite',5),('ROU_028','sommeil',3),('ROU_028','hormones',3),
-- ROU_029 Journal alimentaire
('ROU_029','digestion',4),('ROU_029','hormones',3),
-- ROU_030 Micro-sieste digestive
('ROU_030','vitalite',3),('ROU_030','serenite',3),('ROU_030','sommeil',3),('ROU_030','digestion',4),
-- ROU_031 Lecture créative
('ROU_031','serenite',4),('ROU_031','sommeil',3),
-- ROU_032 Respiration alternée (Nadi Shodhana)
('ROU_032','vitalite',3),('ROU_032','serenite',5),('ROU_032','sommeil',4),('ROU_032','mobilite',3),('ROU_032','hormones',3),
-- ROU_033 Box Breathing
('ROU_033','serenite',5),('ROU_033','sommeil',4),('ROU_033','mobilite',3),
-- ROU_034 Fredonnement (Humming/Brahmari)
('ROU_034','serenite',5),('ROU_034','sommeil',4),('ROU_034','digestion',3),
-- ROU_035 Sourire intérieur
('ROU_035','serenite',5),('ROU_035','sommeil',3),('ROU_035','digestion',3),('ROU_035','hormones',3),
-- ROU_036 Jeûne de dopamine
('ROU_036','vitalite',3),('ROU_036','serenite',4),('ROU_036','sommeil',3),('ROU_036','hormones',3),
-- ROU_037 Yoga des yeux
('ROU_037','vitalite',3),('ROU_037','serenite',3),('ROU_037','sommeil',3),
-- ROU_038 Jambes au mur (Viparita Karani)
('ROU_038','vitalite',3),('ROU_038','serenite',4),('ROU_038','sommeil',4),('ROU_038','mobilite',4),('ROU_038','hormones',3),
-- ROU_039 Shake Therapy
('ROU_039','vitalite',3),('ROU_039','serenite',4),('ROU_039','sommeil',3),('ROU_039','mobilite',3),('ROU_039','hormones',3),
-- ROU_040 Étirements du psoas
('ROU_040','vitalite',3),('ROU_040','serenite',4),('ROU_040','sommeil',3),('ROU_040','mobilite',5),('ROU_040','hormones',4),
-- ROU_041 Yoga du visage
('ROU_041','serenite',3),('ROU_041','hormones',4),
-- ROU_042 Micro-mouvements au bureau
('ROU_042','vitalite',4),('ROU_042','serenite',3),('ROU_042','digestion',3),('ROU_042','mobilite',4),
-- ROU_043 Marche consciente (Kinhin)
('ROU_043','vitalite',4),('ROU_043','serenite',4),('ROU_043','sommeil',3),('ROU_043','digestion',3),('ROU_043','mobilite',4),
-- ROU_044 Bain aux sels d'Epsom
('ROU_044','vitalite',3),('ROU_044','serenite',4),('ROU_044','sommeil',5),('ROU_044','mobilite',5),
-- ROU_045 Bain de pieds chaud (Pédiluve)
('ROU_045','serenite',4),('ROU_045','sommeil',4),('ROU_045','mobilite',3),
-- ROU_046 Lavage nasal (Neti Pot)
('ROU_046','vitalite',3),('ROU_046','sommeil',3),
-- ROU_047 Gargarisme à l'eau salée
('ROU_047','vitalite',3),('ROU_047','sommeil',3),('ROU_047','digestion',3),
-- ROU_048 Automassage des mains
('ROU_048','serenite',4),('ROU_048','sommeil',3),('ROU_048','mobilite',3),
-- ROU_049 Automassage abdominal (Chi Nei Tsang)
('ROU_049','serenite',3),('ROU_049','sommeil',3),('ROU_049','digestion',5),('ROU_049','mobilite',3),('ROU_049','hormones',3),
-- ROU_050 Morning Pages
('ROU_050','serenite',4),('ROU_050','sommeil',3),
-- ROU_051 Brain Dumping
('ROU_051','serenite',4),('ROU_051','sommeil',4),
-- ROU_052 Visualisation créative
('ROU_052','vitalite',3),('ROU_052','serenite',4),('ROU_052','sommeil',3),('ROU_052','hormones',3),
-- ROU_053 Rituel des 3 kifs (Gratitude)
('ROU_053','vitalite',3),('ROU_053','serenite',5),('ROU_053','sommeil',4),('ROU_053','hormones',3),
-- ROU_054 Observation contemplative
('ROU_054','serenite',4),('ROU_054','sommeil',3);

-- ============================================================
-- 4. ALIMENTATION_BESOINS
-- ============================================================
TRUNCATE alimentation_besoins;

INSERT INTO alimentation_besoins (aliment_id, besoin_id, score) VALUES
-- ALI_001 Curcuma
('ALI_001','vitalite',3),('ALI_001','digestion',4),('ALI_001','mobilite',5),
-- ALI_002 Gingembre
('ALI_002','vitalite',3),('ALI_002','digestion',5),('ALI_002','mobilite',4),
-- ALI_003 Ail
('ALI_003','vitalite',4),('ALI_003','digestion',3),('ALI_003','mobilite',4),
-- ALI_004 Spiruline
('ALI_004','vitalite',5),('ALI_004','mobilite',3),('ALI_004','hormones',3),
-- ALI_005 Avocat
('ALI_005','serenite',3),('ALI_005','mobilite',4),('ALI_005','hormones',3),
-- ALI_006 Myrtilles
('ALI_006','vitalite',4),('ALI_006','serenite',3),('ALI_006','digestion',3),('ALI_006','mobilite',4),
-- ALI_007 Graines de Chia
('ALI_007','digestion',4),('ALI_007','mobilite',4),('ALI_007','hormones',3),
-- ALI_008 Curcuma (doublon)
('ALI_008','vitalite',3),('ALI_008','digestion',4),('ALI_008','mobilite',5),
-- ALI_009 Mouton
('ALI_009','vitalite',4),('ALI_009','mobilite',3),
-- ALI_010 Saumon sauvage
('ALI_010','vitalite',4),('ALI_010','serenite',4),('ALI_010','mobilite',5),('ALI_010','hormones',4),
-- ALI_011 Kéfir
('ALI_011','vitalite',3),('ALI_011','serenite',3),('ALI_011','sommeil',3),('ALI_011','digestion',5),
-- ALI_012 Noix de Grenoble
('ALI_012','vitalite',3),('ALI_012','serenite',4),('ALI_012','mobilite',4),('ALI_012','hormones',3),
-- ALI_013 Brocoli
('ALI_013','vitalite',4),('ALI_013','digestion',3),('ALI_013','mobilite',3),('ALI_013','hormones',4),
-- ALI_014 Œufs bio
('ALI_014','vitalite',4),('ALI_014','sommeil',3),('ALI_014','hormones',4),
-- ALI_015 Thé Vert Matcha
('ALI_015','vitalite',5),('ALI_015','serenite',4),('ALI_015','mobilite',3),
-- ALI_016 Patate Douce
('ALI_016','vitalite',4),('ALI_016','digestion',3),
-- ALI_017 Gingembre (doublon)
('ALI_017','vitalite',3),('ALI_017','digestion',5),('ALI_017','mobilite',4),
-- ALI_018 Quinoa
('ALI_018','vitalite',4),('ALI_018','digestion',3),
-- ALI_019 Huile d'Olive Extra Vierge
('ALI_019','digestion',3),('ALI_019','mobilite',4),('ALI_019','hormones',3),
-- ALI_020 Citron
('ALI_020','vitalite',4),('ALI_020','digestion',4),
-- ALI_021 Lentilles
('ALI_021','vitalite',4),('ALI_021','digestion',4),
-- ALI_022 Spiruline (doublon)
('ALI_022','vitalite',5),('ALI_022','mobilite',3),('ALI_022','hormones',3),
-- ALI_023 Cacao cru
('ALI_023','vitalite',4),('ALI_023','serenite',4),('ALI_023','sommeil',3),('ALI_023','mobilite',3),
-- ALI_024 Chocolat Noir 85%+
('ALI_024','vitalite',4),('ALI_024','serenite',4),('ALI_024','mobilite',3),
-- ALI_025 Baies de Goji
('ALI_025','vitalite',4),('ALI_025','mobilite',3),('ALI_025','hormones',3),
-- ALI_026 Échalote
('ALI_026','vitalite',3),('ALI_026','digestion',3),
-- ALI_027 Cannelle
('ALI_027','digestion',4),('ALI_027','mobilite',3),
-- ALI_028 Citron (doublon)
('ALI_028','vitalite',4),('ALI_028','digestion',4),
-- ALI_029 Miel brut
('ALI_029','vitalite',3),('ALI_029','digestion',3),
-- ALI_030 Poivre noir
('ALI_030','digestion',3),('ALI_030','mobilite',3),
-- ALI_031 Thé vert
('ALI_031','vitalite',4),('ALI_031','serenite',3),('ALI_031','mobilite',3),
-- ALI_032 Graines de lin
('ALI_032','digestion',4),('ALI_032','mobilite',3),('ALI_032','hormones',5),
-- ALI_033 Noix
('ALI_033','serenite',3),('ALI_033','mobilite',4),('ALI_033','hormones',3),
-- ALI_034 Épinards
('ALI_034','vitalite',5),('ALI_034','mobilite',3),('ALI_034','hormones',3),
-- ALI_035 Gingembre séché
('ALI_035','vitalite',3),('ALI_035','digestion',5),('ALI_035','mobilite',4),
-- ALI_036 Grenade
('ALI_036','vitalite',3),('ALI_036','mobilite',4),('ALI_036','hormones',4),
-- ALI_037 Sardines
('ALI_037','vitalite',4),('ALI_037','serenite',3),('ALI_037','mobilite',5),('ALI_037','hormones',3),
-- ALI_038 Cannelle de Ceylan
('ALI_038','digestion',4),('ALI_038','mobilite',3),
-- ALI_039 Noix du Brésil (sélénium → hormones thyroïdiennes)
('ALI_039','serenite',3),('ALI_039','hormones',5),
-- ALI_040 Graines de Courge (zinc, tryptophane)
('ALI_040','vitalite',3),('ALI_040','sommeil',3),('ALI_040','hormones',4),
-- ALI_041 Chou Kale
('ALI_041','vitalite',5),('ALI_041','digestion',3),('ALI_041','mobilite',3),('ALI_041','hormones',4),
-- ALI_042 Champignons Shiitake
('ALI_042','vitalite',4),('ALI_042','mobilite',3),('ALI_042','hormones',3),
-- ALI_043 Graines de Chanvre
('ALI_043','serenite',3),('ALI_043','mobilite',3),('ALI_043','hormones',3),
-- ALI_044 Vinaigre de Cidre
('ALI_044','digestion',5),('ALI_044','mobilite',3),
-- ALI_045 Saumon sauvage (doublon)
('ALI_045','vitalite',4),('ALI_045','serenite',4),('ALI_045','mobilite',5),('ALI_045','hormones',4),
-- ALI_046 Veau
('ALI_046','vitalite',4),('ALI_046','mobilite',3),
-- ALI_047 Maquereau
('ALI_047','vitalite',4),('ALI_047','serenite',3),('ALI_047','mobilite',5),('ALI_047','hormones',3),
-- ALI_048 Poulet (filet)
('ALI_048','vitalite',4),('ALI_048','serenite',3),('ALI_048','sommeil',3),
-- ALI_049 Dinde (tryptophane élevé)
('ALI_049','vitalite',4),('ALI_049','serenite',3),('ALI_049','sommeil',4),
-- ALI_050 bœuf grass-fed
('ALI_050','vitalite',4),('ALI_050','mobilite',3),('ALI_050','hormones',4),
-- ALI_051 Œufs bio
('ALI_051','vitalite',4),('ALI_051','sommeil',3),('ALI_051','hormones',4),
-- ALI_052 Crevettes
('ALI_052','vitalite',3),('ALI_052','mobilite',3),
-- ALI_053 Moules
('ALI_053','vitalite',4),('ALI_053','mobilite',3),
-- ALI_054 Yaourt grec
('ALI_054','vitalite',3),('ALI_054','sommeil',3),('ALI_054','digestion',4),
-- ALI_055 Thon
('ALI_055','vitalite',4),('ALI_055','mobilite',3),
-- ALI_056 Truite arc-en-ciel
('ALI_056','vitalite',4),('ALI_056','mobilite',4),
-- ALI_057 Cabillaud
('ALI_057','vitalite',3),
-- ALI_058 Noix de Saint-Jacques
('ALI_058','vitalite',3),('ALI_058','hormones',3),
-- ALI_059 Lapin
('ALI_059','vitalite',3),
-- ALI_060 Cerf
('ALI_060','vitalite',4),('ALI_060','mobilite',3),
-- ALI_061 Foie de Veau (B12, fer, zinc top)
('ALI_061','vitalite',5),('ALI_061','hormones',4),
-- ALI_062 Parmesan
('ALI_062','vitalite',3),('ALI_062','mobilite',3),
-- ALI_063 Camu Camu
('ALI_063','vitalite',5),('ALI_063','mobilite',3),
-- ALI_064 Noix de Macadamia
('ALI_064','mobilite',3),('ALI_064','hormones',3),
-- ALI_065 Kombucha
('ALI_065','vitalite',3),('ALI_065','digestion',5),
-- ALI_066 Shiitake (doublon)
('ALI_066','vitalite',4),('ALI_066','mobilite',3),('ALI_066','hormones',3),
-- ALI_067 Baies d'Açaï
('ALI_067','vitalite',4),('ALI_067','serenite',3),('ALI_067','mobilite',3),
-- ALI_068 Poudre de Baobab
('ALI_068','vitalite',4),('ALI_068','digestion',4),
-- ALI_069 Aronia
('ALI_069','vitalite',4),('ALI_069','mobilite',4),
-- ALI_070 Chlorelle
('ALI_070','vitalite',4),('ALI_070','digestion',3),('ALI_070','hormones',3),
-- ALI_071 Maca (adaptogène hormonal majeur)
('ALI_071','vitalite',4),('ALI_071','serenite',3),('ALI_071','hormones',5),
-- ALI_072 Lucuma
('ALI_072','vitalite',3),('ALI_072','digestion',3),
-- ALI_073 Amarante
('ALI_073','vitalite',4),('ALI_073','digestion',3),('ALI_073','mobilite',3),
-- ALI_074 Reishi
('ALI_074','vitalite',4),('ALI_074','serenite',4),('ALI_074','sommeil',4),('ALI_074','hormones',3),
-- ALI_075 Maitake
('ALI_075','vitalite',4),('ALI_075','mobilite',3),('ALI_075','hormones',3),
-- ALI_076 Lions Mane
('ALI_076','vitalite',4),('ALI_076','serenite',4),('ALI_076','sommeil',3),
-- ALI_077 Bouillon d'os
('ALI_077','vitalite',3),('ALI_077','digestion',4),('ALI_077','mobilite',5),
-- ALI_078 Huîtres (zinc, fer, iode → hormones++)
('ALI_078','vitalite',5),('ALI_078','mobilite',3),('ALI_078','hormones',5),
-- ALI_079 Foie de bœuf
('ALI_079','vitalite',5),('ALI_079','hormones',4),
-- ALI_080 Ghee
('ALI_080','vitalite',3),('ALI_080','digestion',3),
-- ALI_081 Œufs de saumon
('ALI_081','vitalite',3),('ALI_081','mobilite',3),('ALI_081','hormones',4),
-- ALI_082 Foie de morue (vitamines A, D, EPA)
('ALI_082','vitalite',4),('ALI_082','mobilite',3),('ALI_082','hormones',5),
-- ALI_083 Bouillon de poule
('ALI_083','vitalite',3),('ALI_083','digestion',4),('ALI_083','mobilite',3),
-- ALI_084 Foie de volaille
('ALI_084','vitalite',5),('ALI_084','hormones',4),
-- ALI_085 Rognons de veau
('ALI_085','vitalite',4),('ALI_085','hormones',3),
-- ALI_086 Noix de cajou
('ALI_086','vitalite',3),('ALI_086','serenite',3),
-- ALI_087 Agneau
('ALI_087','vitalite',4),('ALI_087','mobilite',3),
-- ALI_088 Canard (Magret)
('ALI_088','vitalite',4),('ALI_088','mobilite',3),
-- ALI_089 Caille
('ALI_089','vitalite',3),
-- ALI_090 Sanglier
('ALI_090','vitalite',3),
-- ALI_091 Pintade
('ALI_091','vitalite',3),
-- ALI_092 Bison
('ALI_092','vitalite',4),('ALI_092','mobilite',3),
-- ALI_093 boeuf
('ALI_093','vitalite',4),('ALI_093','mobilite',3),
-- ALI_094 poulet (filet) doublon
('ALI_094','vitalite',4),('ALI_094','sommeil',3),
-- ALI_095 Hareng
('ALI_095','vitalite',4),('ALI_095','mobilite',5),('ALI_095','hormones',3),
-- ALI_099 Sole
('ALI_099','vitalite',3),
-- ALI_103 Calamar
('ALI_103','vitalite',3),
-- ALI_107 Feta
('ALI_107','vitalite',3),
-- ALI_111 Flétan
('ALI_111','vitalite',3),
-- ALI_115 Alose
('ALI_115','vitalite',3),('ALI_115','mobilite',3);

-- ============================================================
-- ALIMENTATION_BESOINS - Items ALI_096 → ALI_212 (ajout)
-- ============================================================

-- Poissons gras / semi-gras
INSERT INTO alimentation_besoins (aliment_id, besoin_id, score) VALUES
('ALI_096','vitalite',4),('ALI_096','mobilite',4),('ALI_096','hormones',3),
('ALI_118','vitalite',4),('ALI_118','mobilite',4),
('ALI_119','vitalite',4),('ALI_119','mobilite',5),('ALI_119','hormones',3),
-- Poissons maigres
('ALI_097','vitalite',3),('ALI_097','mobilite',3),
('ALI_098','vitalite',3),('ALI_098','mobilite',3),
('ALI_100','vitalite',3),('ALI_101','vitalite',3),
('ALI_109','vitalite',3),('ALI_109','mobilite',3),
('ALI_110','vitalite',3),('ALI_112','vitalite',3),('ALI_113','vitalite',3),
('ALI_114','vitalite',3),('ALI_116','vitalite',3),('ALI_117','vitalite',3),
('ALI_120','vitalite',3),('ALI_121','vitalite',3),('ALI_123','vitalite',3),('ALI_124','vitalite',3),
-- Fruits de mer
('ALI_102','vitalite',3),('ALI_102','mobilite',3),
('ALI_104','vitalite',4),('ALI_104','hormones',3),
('ALI_105','vitalite',3),('ALI_106','vitalite',3),
('ALI_122','vitalite',3),('ALI_122','hormones',3),
-- Produits laitiers
('ALI_108','vitalite',3),('ALI_108','digestion',4),
('ALI_125','vitalite',3),('ALI_126','vitalite',3),
-- Oléagineux
('ALI_127','serenite',4),('ALI_127','mobilite',3),('ALI_127','hormones',3),
('ALI_128','serenite',3),('ALI_128','mobilite',3),
('ALI_129','serenite',3),('ALI_129','mobilite',3),('ALI_129','hormones',3),
('ALI_130','serenite',3),('ALI_130','sommeil',3),
('ALI_131','mobilite',3),('ALI_131','serenite',3),
('ALI_132','vitalite',3),('ALI_132','mobilite',3),
('ALI_133','mobilite',3),('ALI_133','hormones',3),
('ALI_134','mobilite',3),('ALI_134','hormones',3),
('ALI_135','vitalite',3),('ALI_135','digestion',3),
('ALI_136','vitalite',3),('ALI_136','serenite',3),
('ALI_137','vitalite',3),('ALI_137','serenite',3),
('ALI_143','vitalite',3),('ALI_143','serenite',3),('ALI_143','hormones',3),
-- Légumineuses
('ALI_138','vitalite',4),('ALI_138','digestion',4),
('ALI_139','vitalite',3),('ALI_139','digestion',3),
('ALI_140','vitalite',4),('ALI_140','digestion',4),
('ALI_141','vitalite',3),('ALI_141','digestion',3),
('ALI_142','vitalite',3),
('ALI_144','vitalite',3),('ALI_144','digestion',3),('ALI_144','hormones',4),
-- Céréales
('ALI_145','vitalite',4),('ALI_145','serenite',3),('ALI_145','digestion',4),
('ALI_146','vitalite',3),
-- Légumes prébiotiques / digestion forte
('ALI_147','digestion',5),('ALI_147','vitalite',3),
('ALI_150','digestion',4),('ALI_150','vitalite',3),
('ALI_153','digestion',5),
('ALI_155','digestion',4),('ALI_155','mobilite',3),
('ALI_156','digestion',5),
('ALI_163','digestion',5),
('ALI_164','digestion',4),('ALI_164','vitalite',3),
('ALI_174','digestion',4),('ALI_174','vitalite',3),
('ALI_162','digestion',4),('ALI_162','vitalite',3),
('ALI_180','sommeil',4),('ALI_180','mobilite',3),
-- Légumes riches en vitamines
('ALI_148','digestion',3),('ALI_148','vitalite',3),
('ALI_149','vitalite',3),('ALI_149','digestion',3),('ALI_149','hormones',3),
('ALI_151','vitalite',4),
('ALI_152','vitalite',4),('ALI_152','hormones',3),
('ALI_154','vitalite',3),('ALI_154','mobilite',3),
('ALI_157','vitalite',3),('ALI_157','digestion',3),
('ALI_158','vitalite',4),
('ALI_159','vitalite',3),('ALI_159','digestion',3),
('ALI_160','digestion',3),('ALI_160','mobilite',3),
('ALI_161','vitalite',4),
('ALI_165','vitalite',3),
('ALI_166','digestion',3),('ALI_166','vitalite',3),
('ALI_167','vitalite',3),('ALI_167','digestion',3),
('ALI_168','digestion',3),
('ALI_169','vitalite',4),('ALI_169','digestion',3),
('ALI_170','digestion',3),('ALI_170','mobilite',3),
('ALI_171','mobilite',3),('ALI_171','hormones',3),
('ALI_172','vitalite',3),
('ALI_173','digestion',3),('ALI_173','vitalite',3),
('ALI_175','vitalite',3),('ALI_175','digestion',3),
('ALI_176','vitalite',3),
('ALI_177','digestion',3),('ALI_177','vitalite',3),('ALI_177','hormones',3),
('ALI_178','vitalite',4),('ALI_178','digestion',3),('ALI_178','hormones',3),
('ALI_179','digestion',3),
('ALI_212','digestion',3),('ALI_212','mobilite',3),
-- Fruits digestifs
('ALI_184','digestion',5),
('ALI_185','digestion',4),
('ALI_193','digestion',4),('ALI_193','mobilite',3),
('ALI_194','digestion',4),
('ALI_197','digestion',5),('ALI_197','mobilite',3),
('ALI_206','vitalite',4),('ALI_206','digestion',4),('ALI_206','sommeil',3),
-- Fruits riches vitamine C / antioxydants
('ALI_182','vitalite',4),
('ALI_188','vitalite',4),
('ALI_190','vitalite',4),
('ALI_191','vitalite',4),('ALI_191','digestion',4),
('ALI_198','vitalite',4),('ALI_198','mobilite',3),
('ALI_199','vitalite',4),('ALI_199','mobilite',3),
('ALI_204','vitalite',4),
('ALI_209','vitalite',4),('ALI_209','mobilite',3),
-- Fruits sommeil / sérénité
('ALI_181','digestion',4),('ALI_181','sommeil',3),
('ALI_187','vitalite',3),('ALI_187','serenite',3),('ALI_187','sommeil',3),
-- Fruits standards
('ALI_183','digestion',3),('ALI_183','vitalite',3),
('ALI_186','vitalite',3),('ALI_186','digestion',3),
('ALI_189','vitalite',3),('ALI_189','mobilite',3),
('ALI_192','vitalite',3),('ALI_192','digestion',3),
('ALI_195','vitalite',3),('ALI_195','digestion',3),
('ALI_196','vitalite',3),
('ALI_200','vitalite',3),('ALI_200','mobilite',3),
('ALI_201','vitalite',3),('ALI_201','digestion',3),
('ALI_202','digestion',3),('ALI_202','mobilite',3),
('ALI_203','vitalite',3),('ALI_203','digestion',3),
('ALI_205','vitalite',3),
('ALI_207','vitalite',3),('ALI_208','vitalite',3),
('ALI_210','vitalite',3),('ALI_210','digestion',3),('ALI_210','hormones',3),
('ALI_211','vitalite',3),('ALI_211','digestion',3);

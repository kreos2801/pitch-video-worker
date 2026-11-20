# Script des 2 tutoriels vidéo (Loom ou Cap.so)

Avant d'enregistrer : la Sheet est initialisée et configurée, la web app est déployée, les secrets GitHub sont en place, et 🧪 Tester les connexions affiche trois ✅. Pour un tutoriel fluide, lancez une génération 5 minutes avant d'enregistrer : vous aurez un résultat de secours si le rendu prend du retard.

## Tutoriel 1 — Installation (≈ 4 min)

| Temps | À l'écran | À dire |
|---|---|---|
| 0:00 | Infographie `docs/infographie.png` | « Une ligne de Sheet devient une vidéo hébergée, sans outil no-code. Voici les 6 étapes. » |
| 0:30 | Dépôt GitHub (dossiers `apps-script`, `worker`, `.github`) | Rôle de chaque dossier |
| 1:00 | Éditeur Apps Script : fichiers 00 à 09 et manifeste | « Drive v3 et Slides en services avancés, aucune clé dans le code. » |
| 1:45 | Menu 🎬 › Initialiser, puis les 3 onglets | Montrer les colonnes imposées et les prompts SCRIPT_A / SCRIPT_B |
| 2:15 | 🎬 › Configurer (masquer la clé à l'écran !) | Propriétés du script = coffre de secrets |
| 2:45 | Déployer la web app, puis 🔑 secrets → GitHub › Secrets | WEBAPP_URL, WORKER_TOKEN |
| 3:30 | 🧪 Tester les connexions → trois ✅ | Fin de l'installation |

## Tutoriel 2 — Utilisation (≈ 4 min)

| Temps | À l'écran | À dire |
|---|---|---|
| 0:00 | Les 3 PDF de l'Option B ouverts rapidement | « Documents fictifs ; la vidéo ne s'appuiera que sur eux. » |
| 0:30 | 🎬 › Importer les exemples, sélectionner la ligne B, ▶ Lancer | Le statut défile : extraction, script IA, visuels |
| 1:15 | Colonnes Script_JSON, Controle_Faits, Nb_Mots_VoixOff | « Chaque chiffre est vérifié dans les PDF : par exemple 11/11 chiffres sourcés. » |
| 1:45 | Lien URL_Slides : les diapositives générées | Notes du présentateur = voix-off (compatible Google Vids) |
| 2:15 | Onglet Actions de GitHub : le rendu en direct | « Déclenché par l'API REST depuis la Sheet, aucun clic. » |
| 2:45 | Retour dans la Sheet : TERMINE + URL_Video_Cloud | Cliquer sur le lien et lire 15 s de la vidéo |
| 3:15 | Brouillon Gmail : GIF cliquable et Calendly | « Envoi manuel volontaire : relecture humaine. » |
| 3:30 | Ligne A (scannée) : CONFIG_LOG montre l'OCR et la pseudonymisation | RGPD : aucun nom réel envoyé à l'IA |
| 3:50 | Démo de garde-fou : modifier un chiffre dans Script_JSON, puis Reprendre → A_VERIFIER | « Une hallucination bloque le rendu. » |

## Liste de contrôle du rendu

- [ ] Sheet avec au moins 2 générations TERMINE (une A, une B)
- [ ] Lien GitHub du code (aucune clé en clair)
- [ ] README.md + infographie 16:9
- [ ] 2 liens Loom ou Cap.so (installation, utilisation)

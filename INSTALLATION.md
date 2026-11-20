# Guide d'installation pas à pas (≈ 20 min)

Prérequis : un compte Google **personnel** (les comptes d'école bloquent parfois le partage public par lien et les web apps « Tout le monde »), un compte GitHub et une clé Gemini (https://aistudio.google.com › Get API key).

## 1. Google Sheet et Apps Script

1. Créez une Google Sheet vide nommée « Tour de contrôle — Pitch vidéo ».
2. **Extensions › Apps Script**. Dans l'éditeur :
   - ⚙ Paramètres du projet › cochez « Afficher le fichier manifeste appsscript.json », puis collez le contenu de `apps-script/appsscript.json`.
   - Créez un fichier de script par fichier `.gs` du dossier `apps-script/` (mêmes noms, dans l'ordre 00 → 09) et collez leur contenu. Supprimez `Code.gs`.
   - Les services avancés **Drive API v3** et **Google Slides API** sont déclarés dans le manifeste. Vérifiez qu'ils apparaissent dans « Services ».
3. Enregistrez, revenez dans la Sheet et rechargez la page : le menu **🎬 Pitch Vidéo** apparaît.
4. 🎬 › **🧱 Initialiser la Tour de contrôle**, puis acceptez les autorisations. Si l'écran « Google n'a pas validé cette application » s'affiche, cliquez sur Paramètres avancés › Accéder au projet. Les onglets PRODUCTION, PROMPTS et CONFIG_LOG sont créés, ainsi que le dossier Drive « Pitch Vidéo — Sorties ».
5. 🎬 › **⚙ Configurer** : collez au minimum la clé Gemini. Le lien Calendly, le nom de l'ESN et la signature sont optionnels. Laissez vide pour conserver une valeur.

## 2. Web app (point de retour du worker)

1. Dans l'éditeur Apps Script : **Déployer › Nouveau déploiement › type Application Web**.
2. Exécuter en tant que : **Moi**. Accès : **Tout le monde**. Le worker n'a pas de compte Google, et chaque requête est protégée par le jeton `WORKER_TOKEN`.
3. Copiez l'URL qui se termine par **/exec**.
4. Après toute modification du code : Déployer › Gérer les déploiements › ✏ › Nouvelle version. L'URL ne change pas.

## 3. Worker de rendu sur GitHub Actions

1. Créez un dépôt GitHub (public = minutes gratuites illimitées ; privé = 2 000 min/mois) et poussez-y ce dossier. `.github/workflows/render.yml` doit être sur la branche `main`.
2. Dépôt › Settings › Secrets and variables › Actions › **New repository secret** :
   - `WEBAPP_URL` : l'URL /exec de l'étape 2
   - `WORKER_TOKEN` : la valeur affichée par 🎬 › **🔑 Afficher les secrets à copier dans GitHub**
3. Créez un jeton : GitHub › Settings › Developer settings › Fine-grained tokens › Generate. Choisissez « Only select repositories » (ce dépôt), puis la permission **Actions : Read and write**.
4. 🎬 › ⚙ Configurer : `GITHUB_REPO` (ex. `yann/pitch-video-worker`) et `GITHUB_TOKEN`.
5. 🎬 › **🧪 Tester les connexions** : trois ✅ attendus (Gemini, GitHub, web app).

*Variante sans GitHub* : ouvrez `colab/worker_colab.ipynb` dans Colab, ajoutez les secrets `WEBAPP_URL` et `WORKER_TOKEN` (icône 🔑), puis lancez les cellules. Le notebook rend tout job en attente.

## 4. Première génération

1. Déposez le dossier `samples/` sur Drive (glisser-déposer).
2. 🎬 › **📥 Importer les exemples** : collez l'URL du dossier. Trois lignes sont ajoutées : A, B, et A avec un brief **scanné** pour démontrer l'OCR.
3. Sélectionnez les lignes, puis 🎬 › **▶ Lancer les lignes sélectionnées**. Comptez environ 1 min par ligne pour les étapes 1 à 3, puis 1 à 3 min de rendu sur GitHub.
4. Le statut passe par `1_EXTRACTION`, `2_SCRIPT_IA`, `3_VISUELS`, `4_RENDU_EN_ATTENTE`, `4_RENDU_EN_COURS` puis `TERMINE`, et `URL_Video_Cloud` se remplit. L'onglet Actions du dépôt montre le rendu en direct.
5. Option : 🎬 › **⏱ Activer le mode automatique**. Toute ligne complète au statut `A_TRAITER` sera traitée sans clic dans les 5 min.

## Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| `A_VERIFIER` | Le contrôle des faits a trouvé un chiffre ou un extrait introuvable | Lire `Controle_Faits`, corriger `Script_JSON`, puis 🎬 › Reprendre après validation humaine |
| `Déclenchement GitHub Actions refusé (HTTP 404)` | Nom du dépôt, jeton ou workflow absent de `main` | Vérifier `GITHUB_REPO` et la permission Actions du jeton |
| Bloqué en `4_RENDU_EN_ATTENTE` | Secrets GitHub erronés, ou URL /dev au lieu de /exec | Onglet Actions › logs du job ; recopier `WEBAPP_URL` |
| `Web app : Non autorisé` dans les logs GitHub | `WORKER_TOKEN` différent | Recopier le jeton depuis 🎬 › 🔑 |
| Partage « limité au domaine » | Compte Workspace d'école | Utiliser un compte Gmail personnel |
| `Modèle indisponible` | Modèle retiré | Modifier `Model_Name` dans PROMPTS (bascule automatique déjà prévue) |
| Brief scanné non lu | OCR Drive insuffisant | Le repli Gemini prend le relais automatiquement (voir CONFIG_LOG) |

## Utiliser vos propres documents

Remplacez les URL de la ligne par celles de vos PDF (ou Google Docs). Pour l'Option B avec votre vrai CV, la vidéo reste fondée uniquement sur ce que contiennent vos documents. Ajustez les prompts dans l'onglet PROMPTS : le ton, la température et le modèle se modifient sans toucher au code.

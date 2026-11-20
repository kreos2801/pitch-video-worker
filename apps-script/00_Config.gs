/**
 * ============================================================================
 *  PITCH VIDÉO PROGRAMMATIQUE — Tour de contrôle (Exercice 8, Growth Hacking)
 * ============================================================================
 *  Chaîne : Google Sheet → extraction PDF (OCR Drive / Gemini) → script JSON
 *  (Gemini, vérifié contre les sources) → Google Slides (visuels + notes) →
 *  worker Python (TTS edge-tts + FFmpeg) → vidéo MP4 sur Drive → URL dans la Sheet.
 *
 *  Aucune clé API dans le code : tout est dans les Propriétés du script
 *  (menu « 🎬 Pitch Vidéo › Configurer »).
 * ============================================================================
 */

var APP = {
  NAME: 'Pitch Vidéo Programmatique',
  VERSION: '1.0.0',

  SHEETS: { PROD: 'PRODUCTION', PROMPTS: 'PROMPTS', LOG: 'CONFIG_LOG' },

  // Les 9 premières colonnes sont celles imposées par le sujet (ordre exact).
  // Les suivantes sont des colonnes de traçabilité ajoutées à droite.
  PROD_HEADERS: [
    'ID_Execution', 'Option_Choisie', 'URL_PDF_1', 'URL_PDF_2_ou_Portfolio', 'URL_Brief_ou_Offre',
    'Statut_Traitement', 'Duree_Audio_Sec', 'URL_Video_Cloud', 'Date_Generation',
    'Script_JSON', 'Nb_Mots_VoixOff', 'Controle_Faits', 'URL_Slides', 'URL_GIF',
    'Brouillon_Gmail', 'Derniere_Etape', 'Email_Destinataire', 'Cout_Estime_USD'
  ],
  PROMPT_HEADERS: ['ID_Prompt', 'Role_Systeme', 'Template_Prompt_User', 'Temperature', 'Model_Name'],
  LOG_HEADERS: ['Timestamp', 'Niveau_Log', 'Etape_Workflow', 'Message_Detaille'],

  STATUS: {
    A_TRAITER: 'A_TRAITER',
    EXTRACTION: '1_EXTRACTION',
    SCRIPT: '2_SCRIPT_IA',
    A_VERIFIER: 'A_VERIFIER',        // le contrôle des faits a échoué : validation humaine requise
    VISUELS: '3_VISUELS',
    RENDU_ATTENTE: '4_RENDU_EN_ATTENTE',
    RENDU: '4_RENDU_EN_COURS',
    TERMINE: 'TERMINE',
    ERREUR: 'ERREUR'
  },

  // Gemini : modèle par défaut si la colonne Model_Name de PROMPTS est vide.
  // Si un modèle renvoie 404 (retiré), on essaie le suivant.
  DEFAULT_MODEL: 'gemini-3.1-flash-lite',
  MODEL_FALLBACKS: ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-2.5-flash'],
  GEMINI_BASE: 'https://generativelanguage.googleapis.com/v1beta',
  // Prix « paid tier » gemini-3.1-flash-lite (USD / million de tokens) — ai.google.dev/pricing, nov. 2026
  PRICE_IN_PER_M: 0.25,
  PRICE_OUT_PER_M: 1.50,

  // Calibrage du script (sujet : 45-60 s, 120-145 mots)
  WORDS_MIN: 120,
  WORDS_MAX: 145,
  WORDS_PER_SEC: 2.5,              // débit moyen d'une voix de synthèse FR (~150 mots/min)
  SCENES_MIN: 4,
  SCENES_MAX: 6,
  TITLE_MAX: 60,
  KEYWORD_MAX: 32,
  MAX_SCRIPT_ATTEMPTS: 3,

  // Extraction
  MIN_DOC_CHARS: 150,              // en dessous : extraction considérée comme ratée → fallback
  MAX_DOC_CHARS: 20000,            // tronqué au-delà (coût + taille de prompt)

  // Worker de rendu
  WORKER_TIMEOUT_MIN: 25,          // au-delà, une ligne bloquée en rendu passe en ERREUR
  TTS_VOICES: { A: 'fr-FR-HenriNeural', B: 'fr-FR-DeniseNeural' },
  TARGET_SECONDS: { min: 45, max: 60 },
  MAX_RUN_MS: 5 * 60 * 1000,       // Apps Script coupe à 6 min

  DISCLOSURE: 'Voix de synthèse · vidéo générée automatiquement à partir des documents fournis',

  // Thèmes visuels (sujet : A = corporate moderne, B = personal branding dynamique)
  THEMES: {
    A: {
      font: 'Montserrat', bg: '#0B1F3A', panel: '#132B50', accent: '#22D3EE', accent2: '#38BDF8',
      text: '#FFFFFF', muted: '#9FB3C8', chipBg: '#16345F', chipText: '#E6F6FF',
      c1: '#38BDF8', c2: '#A78BFA', both: '#34D399', none: '#3B4B63', label: 'Proposition d\'équipe'
    },
    B: {
      font: 'Montserrat', bg: '#121212', panel: '#1E1E1E', accent: '#FF6B35', accent2: '#FFD166',
      text: '#FFFFFF', muted: '#BDBDBD', chipBg: '#2A2A2A', chipText: '#FFFFFF',
      c1: '#FF6B35', c2: '#FFD166', both: '#FF6B35', none: '#3A3A3A', label: 'Candidature'
    }
  }
};

/**
 * Lit la configuration (Propriétés du script). Les secrets ne sont jamais écrits dans la Sheet.
 */
function getConfig_() {
  var p = PropertiesService.getScriptProperties();
  return {
    geminiKey: p.getProperty('GEMINI_API_KEY') || '',
    githubRepo: p.getProperty('GITHUB_REPO') || '',            // ex. yann/pitch-video-worker
    githubToken: p.getProperty('GITHUB_TOKEN') || '',          // PAT fine-grained : Actions (write)
    githubWorkflow: p.getProperty('GITHUB_WORKFLOW') || 'render.yml',
    githubRef: p.getProperty('GITHUB_REF') || 'main',
    workerToken: p.getProperty('WORKER_TOKEN') || '',
    spreadsheetId: p.getProperty('SPREADSHEET_ID') || '',
    outputFolderId: p.getProperty('OUTPUT_FOLDER_ID') || '',
    esnName: p.getProperty('ESN_NAME') || 'Notre ESN',
    calendlyUrl: p.getProperty('CALENDLY_URL') || '',
    contactEmail: p.getProperty('CONTACT_EMAIL') || Session.getEffectiveUser().getEmail(),
    senderName: p.getProperty('SENDER_NAME') || '',
    voiceA: p.getProperty('TTS_VOICE_A') || APP.TTS_VOICES.A,
    voiceB: p.getProperty('TTS_VOICE_B') || APP.TTS_VOICES.B,
    createDraft: (p.getProperty('CREATE_GMAIL_DRAFT') || 'true') === 'true',
    strictFacts: (p.getProperty('STRICT_FACTS') || 'true') === 'true'
  };
}

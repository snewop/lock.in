# Lock-in 🔒⚡ — Dashboard de Sèche Ultime

## Setup en 5 minutes

### 1. Obtenir ta clé Gemini (gratuit)
1. Va sur https://aistudio.google.com/app/apikey
2. Clique "Create API Key"
3. Copie la clé

### 2. Déployer sur Vercel

**Option A : Via GitHub (recommandé)**
1. Crée un repo GitHub et push ce dossier
2. Va sur https://vercel.com → "New Project" → importe ton repo
3. Dans "Environment Variables", ajoute :
   - Name: `VITE_GEMINI_API_KEY`
   - Value: ta clé Gemini
4. Clique "Deploy"

**Option B : Via CLI**
```bash
npm install
npm run dev          # test en local d'abord

# Deploy
npm i -g vercel
vercel               # suit les instructions
# Quand demandé, ajoute la variable d'env VITE_GEMINI_API_KEY
```

### 3. Ajouter à l'écran d'accueil iPhone
1. Ouvre ton URL Vercel dans Safari
2. Tape le bouton "Partager" (carré avec flèche)
3. "Sur l'écran d'accueil"
4. C'est une PWA — ça s'ouvre comme une vraie app

## Fichier .env
Crée un fichier `.env` à la racine :
```
VITE_GEMINI_API_KEY=ta_cle_ici
```

## Stack
- React 18 + Vite
- Recharts (graphiques)
- Gemini 2.0 Flash (estimation macros, vision frigo, pattern detection)
- localStorage (persistance)
- PWA (installable sur iPhone)

## Features
- ⚡ Score Lock-in dynamique
- 📝 Log repas (texte → estimation IA)
- 📸 Photo Food Scanner (Gemini Vision)
- 🧊 Fridge Vision → recettes sèche
- 🎯 Macro Sniper
- 💪 Log muscu + force relative
- 🔥 Cardio Compensator Dynamic
- 💧 Hydratation protocole créatine
- 😴 Sommeil tracker
- 🩺 Symptômes + Pattern Detector IA
- 💸 Budget alimentaire
- 📅 Navigation passé/futur (meal prep)
- 💾 Export/Import JSON

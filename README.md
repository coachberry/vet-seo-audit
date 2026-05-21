# 🐾 VetSEO Auditor

**Professional SEO & GEO auditing tool for veterinary websites.**

Real HTML crawling · Vet-specific schema analysis · Claude AI recommendations · Firestore history · PDF export

---

## What It Does

- **Real crawl** — fetches actual HTML from every page (not simulated)
- **Sitemap builder** — discovers every page visible to visitors AND crawlers, flags noindex/orphan/error pages
- **Full SEO audit** — scores every page on 7 dimensions with vet-specific analysis
- **Competitor comparison** — head-to-head analysis of two vet websites
- **PDF export** — professional reports for clients
- **Audit history** — all audits saved to Firestore

### Scoring Categories
| Score | What It Measures |
|---|---|
| Overall SEO | Title, meta, headings, canonical, internal linking |
| Local SEO | NAP consistency, geo-targeting, local keywords |
| Schema / Structured Data | AnimalHospital, VeterinaryCare, FAQPage, Review, etc. |
| GEO & AI Readiness | Structured for Perplexity, ChatGPT, Google SGE, Gemini |
| Content Quality | Word count, depth, service coverage, species coverage |
| Technical SEO | HTTPS, viewport, Core Web Vitals signals, page speed |
| E-E-A-T | Doctor credentials, authoritativeness, trust signals |

### Veterinary Schema Coverage
Required: `LocalBusiness`, `AnimalHospital`, `VeterinaryCare`, `Organization`, `WebSite`, `WebPage`

Recommended: `FAQPage`, `Review`, `AggregateRating`, `Person/Physician`, `Service`, `OpeningHoursSpecification`, `GeoCoordinates`, `PostalAddress`, `BreadcrumbList`, `Article`, `ImageObject`, `ContactPoint`, `SiteLinksSearchBox`

---

## Architecture

```
GitHub Pages         →  Frontend (index.html, styles.css, app.js)
Firebase Functions   →  Crawler + Claude analysis (3 endpoints)
Firestore           →  Audit history storage
Claude API          →  Vet-specific scoring & recommendations
```

---

## Setup Instructions

### Prerequisites
- [Node.js](https://nodejs.org/) v20+
- [Firebase CLI](https://firebase.google.com/docs/cli): `npm install -g firebase-tools`
- A [Firebase project](https://console.firebase.google.com/) (free Spark plan works)
- A [Claude API key](https://console.anthropic.com/)
- A [GitHub account](https://github.com/)

---

### Step 1 — Clone / Create GitHub Repo

1. Create a new repo on GitHub (e.g. `vetseo-auditor`)
2. Clone it locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/vetseo-auditor.git
   cd vetseo-auditor
   ```
3. Copy all files from this project into the folder

---

### Step 2 — Configure Firebase

1. Log in to Firebase:
   ```bash
   firebase login
   ```

2. Initialize Firebase in the project folder:
   ```bash
   firebase use --add
   ```
   Select your Firebase project when prompted.

3. Enable **Firestore** in the Firebase console:
   - Go to Firebase Console → Firestore Database → Create database → Start in test mode

4. Enable **Cloud Functions** (requires Blaze pay-as-you-go plan — still ~free for low usage):
   - Firebase Console → Functions → Get Started

---

### Step 3 — Set Your Claude API Key

```bash
# Using Firebase Secrets (recommended for production)
firebase functions:secrets:set ANTHROPIC_API_KEY
# Paste your key when prompted

# OR using Firebase config (simpler)
firebase functions:config:set anthropic.api_key="sk-ant-YOUR_KEY_HERE"
```

---

### Step 4 — Deploy Cloud Functions

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

After deploy, you'll see output like:
```
✔ functions[auditSite]: https://us-central1-YOUR_PROJECT.cloudfunctions.net/auditSite
✔ functions[buildSitemap]: https://us-central1-YOUR_PROJECT.cloudfunctions.net/buildSitemap
✔ functions[compareSites]: https://us-central1-YOUR_PROJECT.cloudfunctions.net/compareSites
```

Copy your base URL: `https://us-central1-YOUR_PROJECT.cloudfunctions.net`

---

### Step 5 — Configure Frontend

Open `firebase-config.js` and fill in your values:

```javascript
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",            // Firebase Console → Project Settings → Your Apps
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

export const FUNCTIONS_BASE_URL = "https://us-central1-YOUR_PROJECT.cloudfunctions.net";
```

Find these values in: Firebase Console → Project Settings → Your Apps → SDK setup

---

### Step 6 — Deploy Firestore Rules

```bash
firebase deploy --only firestore:rules
```

---

### Step 7 — Deploy to GitHub Pages

1. Push everything to GitHub:
   ```bash
   git add .
   git commit -m "Initial deploy"
   git push origin main
   ```

2. Enable GitHub Pages:
   - Go to your repo → Settings → Pages
   - Source: **GitHub Actions**

3. The workflow in `.github/workflows/deploy.yml` will auto-deploy on every push.

4. Your app will be live at: `https://YOUR_USERNAME.github.io/vetseo-auditor/`

---

## Usage

### SEO Audit
1. Enter a veterinary website URL (e.g. `https://bestvetclinic.com`)
2. Choose page limit (50 recommended for most vet sites)
3. Click **Run SEO Audit**
4. Wait ~2-3 minutes for crawl + analysis
5. Browse page-by-page scores, expand any page for full audit details
6. Use filters to sort by score or find weakest areas
7. Export to PDF for client reports

### Sitemap Builder
1. Enter the root domain
2. Click **Build Sitemap**
3. See the full URL hierarchy with status flags:
   - **OK** — indexed and linked normally
   - **NOINDEX** — hidden from search engines
   - **ORPHAN** — no inbound links found
   - **ERROR** — 4xx/5xx response
   - **REDIRECT** — redirected URL

### Competitor Compare
1. Enter your client's vet website URL
2. Enter a competitor's URL
3. Click **Compare Sites**
4. See head-to-head scores, advantages, and gap-closing recommendations

---

## Cost Estimates (Firebase Blaze + Claude)

| Usage | Estimated Cost |
|---|---|
| 10 full audits/month (50 pages each) | ~$5-15 Claude API + Firebase ~$0 |
| 50 audits/month | ~$25-75 Claude API + Firebase ~$1-5 |
| Function invocations | Firebase gives 2M free/month |
| Firestore reads/writes | Firebase gives 50K free/day |

Claude API pricing: ~$0.003/1K input tokens, ~$0.015/1K output tokens (Sonnet 4)

---

## File Structure

```
vetseo-auditor/
├── index.html              Frontend app
├── styles.css              All styles
├── app.js                  Frontend logic (Firebase, rendering, PDF)
├── firebase-config.js      Your Firebase config (fill this in)
├── firebase.json           Firebase project config
├── firestore.rules         Firestore security rules
├── .gitignore
├── .github/
│   └── workflows/
│       └── deploy.yml      Auto-deploy to GitHub Pages
├── functions/
│   ├── index.js            Cloud Function endpoints (3)
│   ├── crawler.js          Real HTML crawler engine
│   ├── analyzer.js         Claude analysis prompts & scoring
│   └── package.json
└── README.md
```

---

## Troubleshooting

**Functions timeout?**
- Reduce page limit to 25 for large sites
- Functions are set to 540s max — complex sites may need this

**CORS errors?**
- Ensure your Functions deployed correctly
- Check FUNCTIONS_BASE_URL in firebase-config.js has no trailing slash

**Firebase auth errors?**
- Make sure your Firebase project ID is correct in firebase-config.js
- Run `firebase login` again if needed

**Claude API errors?**
- Verify your API key: `firebase functions:secrets:get ANTHROPIC_API_KEY`
- Check you have credits in your Anthropic account

**GitHub Pages not updating?**
- Check Actions tab in GitHub for deploy status
- Make sure GitHub Pages source is set to "GitHub Actions"

---

## Security Notes

- The Firestore rules are open by default — add Firebase Authentication before sharing publicly with clients
- Your Claude API key is stored as a Firebase Secret (never in code)
- GitHub Pages serves static files only — no sensitive keys are exposed

---

## License

MIT — build freely, use commercially.

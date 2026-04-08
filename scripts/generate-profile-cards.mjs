import fs from "node:fs";
import path from "node:path";

const primaryToken = process.env.PROFILE_TOKEN?.trim() || "";
const fallbackToken = process.env.PROFILE_FALLBACK_TOKEN?.trim() || "";
const login = process.env.PROFILE_LOGIN;
const outputDir = process.env.OUTPUT_DIR || "dist";
const requestedPrivate = process.env.PROFILE_INCLUDE_PRIVATE === "true";
const authState = {
  token: primaryToken || fallbackToken,
  canUsePrivate: requestedPrivate && Boolean(primaryToken),
  fellBack: false,
};

if (!login) {
  throw new Error("Missing PROFILE_LOGIN");
}

const languageColors = {
  Astro: "#ff5d01",
  C: "#555555",
  "C#": "#178600",
  "C++": "#f34b7d",
  CSS: "#663399",
  Dart: "#00B4AB",
  Elixir: "#6e4a7e",
  Go: "#00ADD8",
  HTML: "#e34c26",
  Java: "#b07219",
  JavaScript: "#f1e05a",
  Kotlin: "#A97BFF",
  Lua: "#000080",
  MDX: "#1b1f24",
  PHP: "#4F5D95",
  Python: "#3572A5",
  Ruby: "#701516",
  Rust: "#dea584",
  SCSS: "#c6538c",
  Shell: "#89e051",
  Svelte: "#ff3e00",
  Swift: "#F05138",
  TypeScript: "#3178c6",
  Vue: "#41b883",
};

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function githubRequest(url) {
  const makeHeaders = () => ({
    Accept: "application/vnd.github+json",
    "User-Agent": "xijaja-profile-cards",
    ...(authState.token ? { Authorization: `Bearer ${authState.token}` } : {}),
  });

  let response = await fetch(url, {
    headers: makeHeaders(),
  });

  if (response.status === 401 && primaryToken && fallbackToken && !authState.fellBack) {
    authState.token = fallbackToken;
    authState.canUsePrivate = false;
    authState.fellBack = true;
    response = await fetch(url, {
      headers: makeHeaders(),
    });
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText} for ${url}\n${body}`);
  }

  return response.json();
}

async function loadUserProfile() {
  return githubRequest(`https://api.github.com/users/${encodeURIComponent(login)}`);
}

async function loadOwnedRepos() {
  const repos = [];
  let page = 1;

  while (true) {
    const url = authState.canUsePrivate
      ? `https://api.github.com/user/repos?visibility=all&affiliation=owner&sort=updated&per_page=100&page=${page}`
      : `https://api.github.com/users/${encodeURIComponent(login)}/repos?type=owner&sort=updated&per_page=100&page=${page}`;

    const pageRepos = await githubRequest(url);
    if (!Array.isArray(pageRepos) || pageRepos.length === 0) {
      break;
    }

    repos.push(...pageRepos.filter((repo) => !repo.fork && repo.owner?.login === login));
    if (pageRepos.length < 100) {
      break;
    }

    page += 1;
  }

  return repos;
}

async function loadRepoLanguages(repo) {
  return githubRequest(repo.languages_url);
}

async function loadProfileData() {
  const profile = await loadUserProfile();
  const repos = await loadOwnedRepos();
  let totalStars = 0;
  let privateRepoCount = 0;
  const languages = new Map();

  for (const repo of repos) {
    totalStars += repo.stargazers_count;
    if (repo.private) {
      privateRepoCount += 1;
    }

    const repoLanguages = await loadRepoLanguages(repo);
    for (const [name, size] of Object.entries(repoLanguages)) {
      const current = languages.get(name) ?? {
        name,
        color: languageColors[name] || "#94a3b8",
        size: 0,
      };

      current.size += size;
      languages.set(name, current);
    }
  }

  const sortedLanguages = [...languages.values()].sort((left, right) => right.size - left.size);
  const totalLanguageBytes = sortedLanguages.reduce((sum, language) => sum + language.size, 0);

  return {
    followers: profile.followers,
    following: profile.following,
    repoCount: repos.length,
    totalStars,
    privateRepoCount,
    languages: sortedLanguages,
    totalLanguageBytes,
    includePrivate: authState.canUsePrivate,
    usedFallbackToken: authState.fellBack,
  };
}

function renderStatsCard(theme, stats) {
  const palette = theme === "dark"
    ? {
        bg: "#0d1117",
        border: "#30363d",
        title: "#2f81f7",
        text: "#e6edf3",
        muted: "#8b949e",
        panel: "#161b22",
      }
    : {
        bg: "#ffffff",
        border: "#d0d7de",
        title: "#0969da",
        text: "#24292f",
        muted: "#57606a",
        panel: "#f6f8fa",
      };

  const metrics = [
    { label: "Total Stars", value: stats.totalStars.toLocaleString("en-US") },
    { label: "Owned Repos", value: stats.repoCount.toLocaleString("en-US") },
    { label: "Followers", value: stats.followers.toLocaleString("en-US") },
    { label: "Following", value: stats.following.toLocaleString("en-US") },
  ];

  const tiles = metrics.map((metric, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 24 + column * 186;
    const y = 54 + row * 50;

    return `
      <rect x="${x}" y="${y}" width="164" height="40" rx="6" fill="${palette.panel}" />
      <text x="${x + 14}" y="${y + 16}" font-size="11" fill="${palette.muted}">${escapeXml(metric.label)}</text>
      <text x="${x + 14}" y="${y + 31}" font-size="18" font-weight="700" fill="${palette.text}">${escapeXml(metric.value)}</text>
    `;
  }).join("");

  return `
<svg width="400" height="170" viewBox="0 0 400 170" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(login)} GitHub stats">
  <rect x="0.5" y="0.5" width="399" height="169" rx="6" fill="${palette.bg}" stroke="${palette.border}" />
  <text x="24" y="30" font-family="'Segoe UI', Ubuntu, Sans-Serif" font-size="18" font-weight="700" fill="${palette.title}">${escapeXml(login)} GitHub Stats</text>
  ${tiles}
</svg>`.trimStart();
}

function renderLanguagesCard(theme, stats) {
  const palette = theme === "dark"
    ? {
        bg: "#0d1117",
        border: "#30363d",
        title: "#2f81f7",
        text: "#e6edf3",
        muted: "#8b949e",
        track: "#161b22",
      }
    : {
        bg: "#ffffff",
        border: "#d0d7de",
        title: "#0969da",
        text: "#24292f",
        muted: "#57606a",
        track: "#f6f8fa",
      };

  const topLanguages = stats.languages.slice(0, 5);
  const chart = topLanguages.map((language, index) => {
    const percent = stats.totalLanguageBytes > 0 ? (language.size / stats.totalLanguageBytes) * 100 : 0;
    const y = 52 + index * 23;
    const width = Math.max(8, Math.round((percent / 100) * 190));

    return `
      <text x="24" y="${y}" font-family="'Segoe UI', Ubuntu, Sans-Serif" font-size="11" fill="${palette.text}">${escapeXml(language.name)}</text>
      <rect x="132" y="${y - 9}" width="190" height="8" rx="4" fill="${palette.track}" />
      <rect x="132" y="${y - 9}" width="${width}" height="8" rx="4" fill="${language.color || palette.title}" />
      <text x="334" y="${y}" font-family="'Segoe UI', Ubuntu, Sans-Serif" font-size="11" fill="${palette.muted}">${percent.toFixed(1)}%</text>
    `;
  }).join("");

  return `
<svg width="420" height="170" viewBox="0 0 420 170" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(login)} top languages">
  <rect x="0.5" y="0.5" width="419" height="169" rx="6" fill="${palette.bg}" stroke="${palette.border}" />
  <text x="24" y="30" font-family="'Segoe UI', Ubuntu, Sans-Serif" font-size="18" font-weight="700" fill="${palette.title}">Top Languages</text>
  ${chart}
</svg>`.trimStart();
}

async function main() {
  const stats = await loadProfileData();
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "stats-light.svg"), renderStatsCard("light", stats));
  fs.writeFileSync(path.join(outputDir, "stats-dark.svg"), renderStatsCard("dark", stats));
  fs.writeFileSync(path.join(outputDir, "top-langs-light.svg"), renderLanguagesCard("light", stats));
  fs.writeFileSync(path.join(outputDir, "top-langs-dark.svg"), renderLanguagesCard("dark", stats));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

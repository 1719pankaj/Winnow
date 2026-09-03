import fs from 'node:fs';
import path from 'node:path';

export interface GitHubIssueResult {
  number: number;
  html_url: string;
}

export interface UploadScreenshotResult {
  url: string;
  localPath: string;
}

function getGitHubConfig() {
  const token = process.env.GITHUB_TOKEN?.trim() || '';
  const repoFullName = process.env.GITHUB_REPO?.trim() || '1719pankaj/Winnow';
  const [owner, repo] = repoFullName.split('/');
  return { token, owner: owner || '1719pankaj', repo: repo || 'Winnow' };
}

/**
 * Saves screenshot locally and attempts to commit it to the repository via GitHub Contents API
 * so it can be rendered inline directly within the GitHub Issue.
 */
export async function uploadScreenshotToGitHub(
  base64DataUrl: string,
  filename: string
): Promise<UploadScreenshotResult> {
  const { token, owner, repo } = getGitHubConfig();

  // Extract raw base64 string
  const base64Content = base64DataUrl.includes(',')
    ? base64DataUrl.split(',')[1]
    : base64DataUrl;

  // 1. Always save to local public/feedback directory first
  const feedbackDir = path.join(process.cwd(), 'public', 'feedback');
  if (!fs.existsSync(feedbackDir)) {
    fs.mkdirSync(feedbackDir, { recursive: true });
  }

  const localFilePath = path.join(feedbackDir, filename);
  try {
    fs.writeFileSync(localFilePath, Buffer.from(base64Content, 'base64'));
  } catch (err) {
    console.warn('[GitHub] Failed to write screenshot locally:', err);
  }

  const localRelativeUrl = `/feedback/${filename}`;
  const defaultPermanentUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/public/feedback/${filename}`;

  if (!token) {
    return { url: localRelativeUrl, localPath: localFilePath };
  }

  // 2. Commit file to GitHub via GitHub Contents API
  try {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/public/feedback/${filename}`;
    const res = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Winnow-Issue-Reporter',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        message: `chore(feedback): upload issue screenshot ${filename}`,
        content: base64Content,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const downloadUrl = data.content?.download_url || defaultPermanentUrl;
      return { url: downloadUrl, localPath: localFilePath };
    } else {
      const errorText = await res.text();
      console.warn(`[GitHub Contents API] Non-OK status ${res.status}:`, errorText);
    }
  } catch (err) {
    console.warn('[GitHub Contents API] Failed to upload screenshot to repo:', err);
  }

  return { url: defaultPermanentUrl, localPath: localFilePath };
}

/**
 * Creates an issue on GitHub with rich markdown details
 */
export async function createGitHubIssue(params: {
  title: string;
  body: string;
  labels?: string[];
}): Promise<GitHubIssueResult> {
  const { token, owner, repo } = getGitHubConfig();

  if (!token) {
    throw new Error('GITHUB_TOKEN is not configured in environment.');
  }

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/issues`;
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Winnow-Issue-Reporter',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      title: params.title,
      body: params.body,
      labels: params.labels || ['user-report', 'bug'],
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`GitHub API returned HTTP ${res.status}: ${errorBody}`);
  }

  const data = await res.json();
  return {
    number: data.number,
    html_url: data.html_url,
  };
}

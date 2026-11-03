import { toReleaseInfo } from './release';

const release = {
  tag_name: 'v0.5.2',
  name: 'macItRun 0.5.2',
  published_at: '2026-11-03T04:47:31Z',
  body: '  Atualizações automáticas  ',
  html_url: 'https://github.com/matheusrosa27/macItRun-runtime/releases/tag/v0.5.2',
  assets: [
    { name: 'latest.json', size: 385, browser_download_url: 'https://example.com/latest.json' },
    { name: 'macItRun.zip', size: 3010045, browser_download_url: 'https://example.com/macItRun.zip' },
  ],
};

describe('toReleaseInfo', () => {
  it('takes the version, notes and the .zip asset', () => {
    expect(toReleaseInfo(release)).toEqual({
      version: '0.5.2',
      name: 'macItRun 0.5.2',
      publishedAt: '2026-11-03T04:47:31Z',
      notes: 'Atualizações automáticas',
      htmlUrl: release.html_url,
      zipUrl: 'https://example.com/macItRun.zip',
      zipSize: 3010045,
    });
  });

  it('ignores a release without macItRun.zip', () => {
    expect(toReleaseInfo({ ...release, assets: [] })).toBeNull();
  });
});

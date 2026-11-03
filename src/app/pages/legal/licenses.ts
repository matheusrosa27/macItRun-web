import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { TableModule } from 'primeng/table';
import { WINE_SOURCES_URL } from '../../core/site';
import { LegalPage } from './legal-page';

interface Notice {
  component: string;
  license: string;
  source: string;
}

/** Os mesmos componentes da tela "Licenças" do app (Licenses.swift e graphics.json). */
const APP_NOTICES: Notice[] = [
  { component: 'Wine', license: 'LGPL-2.1-or-later', source: WINE_SOURCES_URL },
  { component: 'GnuTLS', license: 'LGPL-2.1-or-later', source: WINE_SOURCES_URL },
  { component: 'Nettle', license: 'LGPL-3.0-or-later OR GPL-2.0-or-later', source: WINE_SOURCES_URL },
  { component: 'GMP', license: 'LGPL-3.0-or-later OR GPL-2.0-or-later', source: WINE_SOURCES_URL },
  { component: 'FreeType', license: 'FTL OR GPL-2.0', source: WINE_SOURCES_URL },
  { component: 'MoltenVK', license: 'Apache-2.0', source: 'https://github.com/KhronosGroup/MoltenVK' },
  { component: 'DXMT v0.80', license: 'MIT', source: 'https://github.com/3Shain/dxmt/tree/v0.80' },
  {
    component: 'DXVK-macOS 1.10.3',
    license: 'Zlib',
    source: 'https://github.com/Gcenx/DXVK-macOS/tree/v1.10.3-20230507',
  },
];

const SITE_NOTICES: Notice[] = [
  { component: 'Angular', license: 'MIT', source: 'https://github.com/angular/angular' },
  { component: 'PrimeNG', license: 'MIT', source: 'https://github.com/primefaces/primeng' },
  { component: 'PrimeIcons', license: 'MIT', source: 'https://github.com/primefaces/primeicons' },
  { component: 'Tailwind CSS', license: 'MIT', source: 'https://github.com/tailwindlabs/tailwindcss' },
  { component: 'Transloco', license: 'MIT', source: 'https://github.com/jsverse/transloco' },
];

@Component({
  selector: 'app-licenses',
  imports: [LegalPage, TranslocoPipe, TableModule],
  templateUrl: './licenses.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Licenses {
  protected readonly sections = ['wine'];
  protected readonly wineSourcesUrl = WINE_SOURCES_URL;
  protected readonly groups = [
    { key: 'app', notices: APP_NOTICES },
    { key: 'site', notices: SITE_NOTICES },
  ];
}

/**
 * O manifesto da extensão, sem navegador.
 *
 * O Chrome recusa carregar a extensão quando um campo passa do limite do
 * manifesto, e a mensagem não aparece em lugar nenhum da página: o filtro
 * simplesmente não roda. Foi o que aconteceu na 1.10.0 — a `description` ficou
 * com 133 caracteres contra o teto de 132 do Chrome, e o navegador recusou o
 * pacote inteiro. Esta suíte lê o manifesto de verdade, confere os limites e
 * os arquivos que ele aponta, para o defeito não voltar em silêncio.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** Os limites do manifesto do Chrome para os campos de texto. */
const LIMITS = {
  name: 75,
  description: 132,
  version: 20,
};

let failures = 0;

function check(label, condition, detail = '') {
  if (!condition) failures += 1;
  process.stdout.write(`  ${condition ? 'ok  ' : 'FALHA'} ${label}${detail ? ` — ${detail}` : ''}\n`);
}

function checkFile(label, path) {
  check(label, typeof path === 'string' && existsSync(join(root, path)), path);
}

process.stdout.write('manifesto da extensão:\n');
check('é MV3', manifest.manifest_version === 3);
check(
  `o nome cabe em ${LIMITS.name} caracteres`,
  typeof manifest.name === 'string' && manifest.name.length > 0 && manifest.name.length <= LIMITS.name,
  `${String(manifest.name).length}`,
);
check(
  `a descrição cabe em ${LIMITS.description} caracteres`,
  typeof manifest.description === 'string' &&
    manifest.description.length > 0 &&
    manifest.description.length <= LIMITS.description,
  `${String(manifest.description).length}`,
);
check(
  'a versão tem a forma que o Chrome aceita',
  typeof manifest.version === 'string' &&
    manifest.version.length <= LIMITS.version &&
    /^\d+(\.\d+){0,3}$/.test(manifest.version),
  manifest.version,
);
check(
  'manifesto e package contam a mesma versão',
  manifest.version === pkg.version,
  `${manifest.version} vs ${pkg.version}`,
);
check('o nome do package é o da extensão', pkg.name === 'content-manager-extension', pkg.name);

process.stdout.write('\npermissões:\n');
check(
  'as permissões são as quatro mínimas declaradas',
  JSON.stringify(manifest.permissions) ===
    JSON.stringify(['storage', 'declarativeNetRequest', 'scripting', 'sidePanel']),
  JSON.stringify(manifest.permissions ?? []),
);
check(
  'o painel lateral está declarado',
  manifest.side_panel && typeof manifest.side_panel.default_path === 'string',
  manifest.side_panel && manifest.side_panel.default_path,
);

process.stdout.write('\narquivos apontados pelo manifesto:\n');
checkFile('o service worker existe', manifest.background && manifest.background.service_worker);
checkFile('o popup existe', manifest.action && manifest.action.default_popup);
checkFile('a página do painel lateral existe', manifest.side_panel && manifest.side_panel.default_path);
for (const [size, path] of Object.entries(manifest.icons || {})) {
  checkFile(`o ícone ${size} existe`, path);
}
for (const [index, entry] of (manifest.content_scripts || []).entries()) {
  const numero = index + 1;
  check(
    `o content script ${numero} tem destino`,
    Array.isArray(entry.matches) && entry.matches.length > 0,
  );
  for (const file of entry.js || []) checkFile(`o script ${file} existe`, file);
}
for (const entry of manifest.web_accessible_resources || []) {
  check(
    'o recurso aberto declara destino',
    Array.isArray(entry.matches) && entry.matches.length > 0,
  );
  for (const file of entry.resources || []) checkFile(`o recurso ${file} existe`, file);
}
check(
  'o filtro do YouTube está declarado com os cinco scripts, na ordem',
  (manifest.content_scripts || []).some(
    (entry) =>
      JSON.stringify(entry.js) ===
      JSON.stringify([
        'src/content/age-core.js',
        'src/content/keyword-core.js',
        'src/content/channel-rules.js',
        'src/content/channel-button.js',
        'src/content/age-filter.js',
      ]),
  ),
);

process.stdout.write(
  failures === 0 ? '\nmanifesto da extensão: tudo certo\n' : `\nmanifesto da extensão: ${failures} falha(s)\n`,
);

process.exit(failures === 0 ? 0 : 1);

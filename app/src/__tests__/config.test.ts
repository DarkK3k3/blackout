// Une variable d'environnement VIDE doit se comporter comme absente.
//
// La compilation automatique transmet une chaine vide quand aucune
// adresse n'est fournie. Avec `??`, cette chaine vide serait une valeur
// valide : l'app partirait avec une adresse de relais vide et aucun
// message ne passerait, sans erreur visible.

describe('valeurs par defaut', () => {
  const ORIGINAL = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL };
    jest.resetModules();
  });

  async function loadConfig() {
    jest.resetModules();
    return require('../config') as typeof import('../config');
  }

  it('utilise la valeur par defaut quand la variable est absente', async () => {
    delete process.env.EXPO_PUBLIC_RELAY_URL;
    const { RELAY_URL } = await loadConfig();
    expect(RELAY_URL).toMatch(/^https:\/\/.+/);
  });

  it('utilise la valeur par defaut quand la variable est VIDE', async () => {
    process.env.EXPO_PUBLIC_RELAY_URL = '';
    const { RELAY_URL } = await loadConfig();
    expect(RELAY_URL).toMatch(/^https:\/\/.+/);
  });

  it('ignore une variable qui ne contient que des espaces', async () => {
    process.env.EXPO_PUBLIC_RELAY_URL = '   ';
    const { RELAY_URL } = await loadConfig();
    expect(RELAY_URL).toMatch(/^https:\/\/.+/);
  });

  it('respecte une adresse reellement fournie', async () => {
    process.env.EXPO_PUBLIC_RELAY_URL = 'https://mon-relais.example';
    const { RELAY_URL } = await loadConfig();
    expect(RELAY_URL).toBe('https://mon-relais.example');
  });
});

// L'avatar n'est pas qu'un ornement : c'est une verification passive.
// Si deux cles differentes pouvaient donner le meme motif, une
// usurpation passerait inapercue. Ces tests protegent cette propriete.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { motifDepuisCle, COTE, PALETTE } from '../components/avatarMath';
import { Avatar } from '../components/Avatar';

describe('motif derive de la cle', () => {
  it('est toujours le meme pour la meme cle', () => {
    const a = motifDepuisCle('cle-publique-de-bob');
    const b = motifDepuisCle('cle-publique-de-bob');
    expect(a).toEqual(b);
  });

  it('change des que la cle change', () => {
    // LE point important : une cle substituee doit se voir.
    const bob = motifDepuisCle('cle-publique-de-bob');
    const imposteur = motifDepuisCle('cle-publique-de-bob-mais-pas-vraiment');
    expect(imposteur.cases).not.toEqual(bob.cases);
    expect(imposteur.empreinteCourte).not.toBe(bob.empreinteCourte);
  });

  it('change meme pour une difference d un seul caractere', () => {
    const a = motifDepuisCle('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    const b = motifDepuisCle('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB');
    expect(a.cases).not.toEqual(b.cases);
  });

  it('produit une grille complete et symetrique', () => {
    const motif = motifDepuisCle('une-cle');
    expect(motif.cases).toHaveLength(COTE * COTE);
    for (let ligne = 0; ligne < COTE; ligne += 1) {
      for (let colonne = 0; colonne < COTE; colonne += 1) {
        expect(motif.cases[ligne * COTE + colonne]).toBe(
          motif.cases[ligne * COTE + (COTE - 1 - colonne)],
        );
      }
    }
  });

  it('choisit une couleur de la palette', () => {
    for (const cle of ['a', 'bb', 'ccc', 'dddd', 'eeeee', 'ffffff', 'ggggggg']) {
      expect(PALETTE).toContain(motifDepuisCle(cle).couleur as never);
    }
  });

  it('donne des motifs varies sur un echantillon de cles', () => {
    // Un generateur qui rendrait souvent la meme chose ne servirait a
    // rien : on verifie que 200 cles donnent 200 motifs distincts.
    const vus = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      vus.add(motifDepuisCle(`cle-numero-${i}`).cases.map((c) => (c ? '1' : '0')).join(''));
    }
    expect(vus.size).toBe(200);
  });

  it('ne plante pas sur une cle vide', () => {
    expect(() => motifDepuisCle('')).not.toThrow();
    expect(motifDepuisCle('').cases).toHaveLength(COTE * COTE);
  });
});

describe('rendu', () => {
  it('affiche le motif quand la cle est connue', () => {
    let arbre!: renderer.ReactTestRenderer;
    act(() => {
      arbre = renderer.create(<Avatar cleIdentite="cle-de-bob" initiales="BO" verifie />);
    });
    const empreinte = motifDepuisCle('cle-de-bob').empreinteCourte;
    const etiquette = arbre.root.findAll((n) =>
      String(n.props.accessibilityLabel ?? '').includes(empreinte),
    );
    expect(etiquette.length).toBeGreaterThan(0);
  });

  it('retombe sur les initiales quand aucune cle n est connue', () => {
    // Inventer un motif sans cle serait un mensonge : le motif affirme
    // « voici cette identite-la ».
    let arbre!: renderer.ReactTestRenderer;
    act(() => {
      arbre = renderer.create(<Avatar cleIdentite="" initiales="??" />);
    });
    const textes = arbre.root
      .findAllByType('Text' as never, { deep: true })
      .flatMap((n) => n.children.filter((c): c is string => typeof c === 'string'));
    expect(textes.join(' ')).toContain('??');
  });
});

# 🗽 Carte Interactive New York

Carte collaborative des lieux à voir à New York, avec **génération automatique d'itinéraires**
à pied et en métro, horaires détaillés, et export vers Google Maps.

![onglets : Lieux · Ma journée · Itinéraire · Sauvegardes](https://img.shields.io/badge/Node-%E2%89%A518-informational)

## Comptes

| Identifiant | Mot de passe |
|-------------|--------------|
| `axel`      | `axel2026`   |
| `simon`     | `simon2026`  |
| `bastien`   | `bastien2026`|
| `leo`       | `leo2026`    |

> ⚠️ Ces mots de passe sont **écrits en clair dans ce dépôt** : ils servent uniquement
> en local. Pour une mise en ligne, définissez la variable d'environnement `ACCOUNTS`
> (format `axel:motdepasse,simon:autre`) — elle remplace entièrement la liste ci-dessus
> et désactive ces mots de passe, même sur une base déjà créée.
> Voir [DEPLOIEMENT.md](DEPLOIEMENT.md).

## Lancer le site

```bash
npm start           # puis ouvrez http://localhost:3000
```

Aucune dépendance à installer : le serveur n'utilise que la bibliothèque standard de Node,
et Leaflet est embarqué dans `public/vendor/`.

Pour que tout le groupe y accède depuis n'importe où : **[DEPLOIEMENT.md](DEPLOIEMENT.md)**
décrit la mise en ligne sur Render pas à pas (`render.yaml` est déjà prêt).
N'importe quel hébergeur Node fait l'affaire — la commande de démarrage est
`node server.js`, et la configuration tient en trois variables d'environnement :

| Variable | Rôle | Défaut |
|----------|------|--------|
| `PORT` | port d'écoute | `3000` |
| `DB_FILE` | emplacement de la base JSON — à placer sur un **disque persistant** | `data/db.json` |
| `ACCOUNTS` | comptes et mots de passe, `axel:mdp,simon:mdp` | les 4 comptes ci-dessus |

## Les deux modes de fonctionnement

Le site détecte automatiquement s'il a un serveur en face :

| | **Mode partagé** (serveur Node) | **Mode local** (site statique) |
|---|---|---|
| Déclenché par | `npm start` | GitHub Pages, ou un simple `python3 -m http.server` dans `public/` |
| Les points ajoutés | sont visibles **par tout le monde** | restent dans **votre navigateur** |
| Badge affiché en haut | `partagé` | `local` |

Le workflow `.github/workflows/pages.yml` publie `public/` sur GitHub Pages — pratique pour
avoir la carte en ligne tout de suite, mais **sans partage entre personnes**.
Pour que chacun voie les points des autres, il faut faire tourner `server.js` quelque part.

## Ce que fait le site

### Lieux
47 points d'intérêt de New York sont préchargés (monuments, musées, points de vue,
quartiers, spots photo, restaurants…), avec durée de visite conseillée, horaires et prix.

Chacun peut **ajouter un lieu** en cliquant sur la carte, le modifier ou le supprimer.
Filtres par catégorie et recherche textuelle.

### Ma journée
Choisissez votre point de départ (ajoutez votre hôtel/Airbnb comme lieu de catégorie
« Hôtel »), vos horaires, votre rythme, puis :

- **« Me proposer des lieux »** sélectionne automatiquement ce qui rentre dans la journée,
  en équilibrant intérêt et proximité avec l'hôtel ;
- **« Générer ma journée »** calcule le meilleur ordre de visite (plus proche voisin
  puis optimisation 2-opt) et produit le programme heure par heure.

Vous pouvez ensuite **réordonner les étapes par glisser-déposer**, en retirer, allonger ou
raccourcir une visite (± 15 min), et regénérer.

### Itinéraire
Le programme détaillé : pour chaque trajet, le site indique s'il vaut mieux **marcher ou
prendre le métro**, avec la station de départ, la ligne, la station d'arrivée et le temps
de marche de chaque côté. Il signale aussi les lieux qui seront fermés à votre arrivée et
les temps d'attente à l'ouverture, et insère les pauses déjeuner et dîner.

### Exports
- **Ouvrir dans Google Maps** (à pied ou en transports) — au-delà de 10 étapes, plusieurs
  liens sont générés, car c'est la limite de Google ;
- **KML** — à importer dans [Google My Maps](https://www.google.com/mymaps) pour retrouver
  tous les points sur votre compte Google ;
- **GPX**, **programme en texte** (à coller dans une conversation), **JSON** (sauvegarde).

### Sauvegardes
Les journées enregistrées sont partagées avec tout le groupe (en mode serveur).

## Comment sont estimés les trajets

Tout est calculé côté navigateur, sans appel à une API externe :

- **marche** : distance à vol d'oiseau × 1,28 (le damier de Manhattan) à 4,6 km/h ;
- **métro** : marche jusqu'à la station la plus proche, 6 min d'attente moyenne, 3 min
  d'accès aux quais, trajet à 28 km/h de moyenne, plus une correspondance s'il n'y a pas
  de ligne directe. Le métro n'est proposé que s'il fait gagner au moins 6 minutes.

Ce sont donc de **bonnes estimations, pas des horaires officiels** : le réseau est
modélisé par une sélection des grands pôles d'échange (`public/js/subway.js`), pas par le
plan complet du MTA. Vérifiez les correspondances exactes dans Google Maps ou Citymapper
le jour J.

## Structure

```
server.js              API + fichiers statiques (aucune dépendance)
render.yaml            blueprint de déploiement Render
data/poi-seed.json     les 47 lieux préchargés
data/db.json           base générée au premier lancement (non versionnée)
public/
  index.html style.css
  js/app.js            interface, carte, formulaires
  js/api.js            accès données (serveur ou localStorage)
  js/planner.js        ordre de visite et programme horaire
  js/routing.js        marche vs métro
  js/subway.js         stations de métro utilisées pour l'estimation
  js/exporter.js       Google Maps, KML, GPX, texte
  vendor/leaflet/      Leaflet 1.9.4 (BSD-2-Clause)
```

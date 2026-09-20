# Mettre le site en ligne — gratuitement

Objectif : que vous quatre voyiez **les mêmes points** depuis n'importe quel téléphone,
sans rien payer.

## Pourquoi Cloudflare et pas Render

Render gratuit n'a pas de disque persistant : la base repart de zéro à chaque
redémarrage, vous perdriez les lieux ajoutés. Et le service s'endort après 15 min
d'inactivité, avec ~50 s de réveil — pénible depuis un téléphone à New York.

Cloudflare Workers + D1 (leur base SQLite gérée) n'a ni l'un ni l'autre de ces défauts,
et reste gratuit très au-delà de votre usage :

| | Offert gratuitement | Votre usage réel |
|---|---|---|
| Requêtes | 100 000 / jour | quelques centaines |
| Stockage D1 | 5 Go | moins de 1 Mo |
| Lignes lues | 5 000 000 / jour | quelques milliers |

Aucune carte bancaire n'est demandée pour le plan gratuit.

## Les étapes

Tout se passe dans un terminal, depuis le dossier du projet.

### 1. Installer l'outil Cloudflare
```bash
npm install
```

### 2. Se connecter à Cloudflare
```bash
npx wrangler login
```
Ça ouvre le navigateur. Créez un compte gratuit si vous n'en avez pas.

### 3. Créer la base de données
```bash
npx wrangler d1 create carte-interactive
```
La commande affiche un bloc contenant un `database_id`. **Copiez cet identifiant
dans `wrangler.toml`**, à la place de `à-remplacer` :

```toml
[[d1_databases]]
binding = "DB"
database_name = "carte-interactive"
database_id = "0123abcd-..."   # ← ici
```

### 4. Définir les mots de passe
```bash
npx wrangler secret put ACCOUNTS
```
Wrangler propose de créer le Worker s'il n'existe pas encore : répondez oui.
Puis collez cette ligne quand il demande la valeur :

```
axel:Brooklyn-76,simon:Chelsea-31,bastien:Harlem-94,leo:Empire-28
```

> Faites bien cette étape **avant** le déploiement : sinon le site démarre avec les
> mots de passe du README, qui sont publics.

### 5. Déployer
```bash
npx wrangler deploy
```

L'URL s'affiche à la fin, du type
`https://carte-interactive-new-york.<votre-compte>.workers.dev`.

### 6. Vérifier
Ouvrez l'URL, connectez-vous. Le badge en haut à droite doit afficher **`partagé`**
(et non `local`) : c'est la preuve que les points sont communs à tout le groupe.

## Les mots de passe en ligne

| Identifiant | Mot de passe |
|-------------|--------------|
| `axel`      | `Brooklyn-76` |
| `simon`     | `Chelsea-31`  |
| `bastien`   | `Harlem-94`   |
| `leo`       | `Empire-28`   |

Ceux du README (`axel2026`…) ne fonctionnent **que** en local. Dès que le secret
`ACCOUNTS` est défini, ils sont désactivés automatiquement, même si le site avait
déjà tourné sans.

### Changer un mot de passe plus tard
```bash
npx wrangler secret put ACCOUNTS
```
Collez la nouvelle liste. C'est immédiat, sans redéploiement. Les sessions ouvertes
avec l'ancien mot de passe sont déconnectées, et **vos lieux sont conservés**.

Retirer un prénom de la liste supprime son compte. Ajouter `mathis:Tribeca-55`
crée un cinquième compte.

### Mettre à jour le site après une modification du code
```bash
npx wrangler deploy
```
Les données ne sont pas touchées : elles vivent dans D1, pas dans le code.

## Sauvegarde

Les données sont dans D1, chez Cloudflare. Pour en garder une copie :
onglet **Sauvegardes** du site → **JSON (sauvegarde)**. À faire avant toute
manipulation risquée.

En ligne de commande :
```bash
npx wrangler d1 export carte-interactive --remote --output=sauvegarde.sql
```

## ⚠️ Attention aux deux URL

Le dépôt contient aussi un workflow GitHub Pages (`.github/workflows/pages.yml`),
qui publie une version **statique** du site. Celle-ci fonctionne, mais chacun n'y voit
que ses propres ajouts (badge `local`) — pas de partage.

Une fois Cloudflare en place, utilisez **uniquement l'URL `workers.dev`** et
communiquez celle-là au groupe, pour éviter que quelqu'un ajoute des lieux sur la
mauvaise et les perde. Si vous préférez supprimer complètement la version GitHub
Pages, effacez `.github/workflows/pages.yml` et désactivez Pages dans les réglages
du dépôt.

## En cas de problème

**« database_id à-remplacer »** — l'étape 3 n'a pas été faite, ou l'identifiant n'a
pas été collé dans `wrangler.toml`.

**Le badge affiche `local`** — le Worker ne répond pas sur `/api/points`.
Vérifiez les journaux : `npx wrangler tail`.

**Les anciens mots de passe marchent encore** — le secret `ACCOUNTS` n'est pas défini.
Vérifiez avec `npx wrangler secret list`.

# Mettre le site en ligne sur Render

Objectif : que vous quatre voyiez **les mêmes points** depuis n'importe quel téléphone.

## Avant de commencer : le plan Render

| Plan | Prix | Ce que ça donne |
|------|------|-----------------|
| **Starter** | ~7 $/mois | Disque persistant → **vos points sont conservés**. C'est ce qu'il vous faut. |
| Free | 0 € | Pas de disque persistant : **tout est effacé** à chaque redémarrage (et le service s'endort après 15 min d'inactivité). |

Le plan gratuit ne convient pas ici : sans disque, la base repart de zéro régulièrement et vous
perdriez les lieux ajoutés. Le fichier `render.yaml` est donc configuré en `starter`.
Comptez ~7 $/mois, résiliable — pour un voyage, quelques mois suffisent.

## Les étapes

### 1. Fusionner la branche
Le blueprint doit être sur `main` :
```bash
git checkout main
git merge claude/nyc-interactive-itinerary-site-iicvhv
git push origin main
```

### 2. Créer le service
1. Aller sur https://dashboard.render.com → **New** → **Blueprint**
2. Connecter le compte GitHub, choisir le dépôt **`leducl/carte-interactive`**
3. Render lit `render.yaml` tout seul et propose le service `carte-interactive-new-york`
4. Il demande la valeur de la variable **`ACCOUNTS`** (elle n'est pas dans le dépôt, exprès).
   Collez cette ligne :

   ```
   axel:Brooklyn-76,simon:Chelsea-31,bastien:Harlem-94,leo:Empire-28
   ```

5. **Apply** / **Create**

### 3. Attendre
Le premier déploiement prend 1 à 2 minutes (aucune dépendance à installer).
L'URL ressemblera à `https://carte-interactive-new-york.onrender.com`.

### 4. Vérifier
Ouvrez l'URL, connectez-vous. Le badge en haut à droite doit afficher **`partagé`**
(et non `local`) : c'est la preuve que le serveur répond et que les points sont communs.

## Les mots de passe en ligne

| Identifiant | Mot de passe |
|-------------|--------------|
| `axel`      | `Brooklyn-76` |
| `simon`     | `Chelsea-31`  |
| `bastien`   | `Harlem-94`   |
| `leo`       | `Empire-28`   |

Ceux du README (`axel2026`…) ne fonctionnent **que** en local. Dès que `ACCOUNTS` est
défini sur Render, ils sont automatiquement désactivés, même si le service avait
déjà démarré sans.

### Changer un mot de passe plus tard
Render → votre service → **Environment** → modifier `ACCOUNTS` → **Save**.
Le service redémarre, le nouveau mot de passe s'applique et les sessions ouvertes
avec l'ancien sont déconnectées. **Vos lieux et itinéraires sont conservés.**

Retirer un prénom de la liste supprime son compte. Ajouter `mathis:Tribeca-55`
crée un cinquième compte.

## Ce qui est conservé, ce qui ne l'est pas

Conservé à chaque redéploiement (c'est le rôle du disque monté sur `/var/data`) :
les lieux ajoutés, les modifications, les journées enregistrées, les sessions ouvertes.

Si vous supprimez le disque dans Render, **tout repart des 47 lieux d'origine**.
Pensez à faire un export JSON de temps en temps (onglet « Sauvegardes ») avant
toute manipulation sur le disque.

## Alternative gratuite

Si vous ne voulez rien payer : gardez GitHub Pages (déjà configuré, workflow
`.github/workflows/pages.yml`). Le site marche, mais **chacun ne verra que ses
propres ajouts** — pas de partage. C'est acceptable si une seule personne
prépare l'itinéraire et l'exporte ensuite vers Google Maps pour le groupe.

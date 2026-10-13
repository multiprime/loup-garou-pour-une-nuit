# Site officiel — Loup-Garou : Pour une Nuit

## Ce que contient cette version
- Une page d'accueil responsive avec l'illustration Halloween déjà présente dans le ZIP du jeu.
- Connexion avec les comptes existants (pseudo + mot de passe du jeu).
- Boutique payée avec les pièces du compte du jeu.
- Récompense mensuelle aléatoire et code cadeau réutilisable via le menu « Code » du jeu.
- Panneau d'administration pour `creator2026`.
- Données stockées dans la même base d'état que le jeu (PostgreSQL via `DATABASE_URL`).

## Installation gratuite (Render)
Le site est servi par le même serveur Express que le jeu : pas besoin d'un deuxième service payant. Render propose généralement un sous-domaine `onrender.com` gratuit pour les web services, avec des limites et une mise en veille selon l'offre. Il faut garder le service du jeu et son stockage PostgreSQL existants.

1. Fais une copie de sauvegarde de ton dépôt GitHub et de ta base PostgreSQL avant tout changement.
2. Copie le contenu de ce ZIP dans le dépôt du jeu en conservant les fichiers existants. Il ajoute le dossier `site/` et modifie `server.js`.
3. Dans les variables d'environnement Render, conserve `DATABASE_URL` et définis `SITE_TOKEN_SECRET` avec une valeur secrète longue et aléatoire (au moins 32 caractères). Ne publie jamais cette valeur dans GitHub.
4. Vérifie `ADMIN_PSEUDO=creator2026`. L'API admin exige le pseudo connecté correspondant et le contrôle est effectué côté serveur.
5. Déploie depuis GitHub. Le site sera servi à la racine du même domaine que le jeu; les routes du jeu restent disponibles. La page web est `/site/` mais le serveur redirige `/` vers le site. Le jeu reste accessible à `/jeu` et les anciens chemins API continuent de fonctionner.
6. Après déploiement, teste avec un compte non-admin, puis avec `creator2026`. Vérifie aussi un achat et un code cadeau avant d'annoncer le site aux joueurs.

## Important
- La boutique est initialisée avec quelques articles d'exemple. Les articles « titre » ajoutent un titre au profil, les articles « classe » ajoutent l'ID de classe aux possessions, les articles XP et trophées ajoutent la quantité correspondante.
- Pour une classe, renseigne un ID qui existe réellement dans `CLASSES` du serveur.
- La liste des récompenses mensuelles se règle dans `websiteRewardPool` dans `server.js`. Le code créé est aussi ajouté à `db.promoCodes` pour être accepté par le système de codes existant.
- PostgreSQL n'est utilisé que si `DATABASE_URL` est défini et que l'initialisation réussit. Vérifie les logs Render après déploiement.
- Le code de connexion du jeu d'origine n'utilise pas de session persistante pour le site : ce site ajoute un jeton signé côté serveur, avec expiration. Il n'enregistre jamais les mots de passe dans le navigateur.
- Le site n'a pas de paiement en euros : seulement les pièces virtuelles, comme demandé.
- Les images utilisées sont celles du ZIP fourni. Les autres éléments visuels sont du CSS/emoji; aucune image extérieure n'est téléchargée.

## Version 2 — changements d'interface
- Moins de liens pour lancer le jeu : les principaux boutons pointent vers `/jeu`.
- Section de téléchargement Android utilisant le fichier `site/downloads/loup-garou.apk` fourni.
- Solde de pièces visible en haut à droite après connexion.
- Panneau `creator2026` : ajout/suppression d'articles et modification du prix.
- Le code APK a été inclus tel que fourni par l'utilisateur. Vérifie qu'il s'agit bien de la version que tu souhaites distribuer avant publication.

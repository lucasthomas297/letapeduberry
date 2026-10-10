# Protection de l’espace propriétaire

État au 10 octobre 2026 : application Cloudflare Access active, offre Zero Trust Free. Diagnostic propriétaire déployé et connexion effective vérifiée ; demandes et paiements publics désactivés.

## Configuration enregistrée

- Application auto-hébergée « Gestion — L’Étape du Berry », session de six heures.
- Destinations `/gestion*` et `/api/admin*` sur `letapeduberry.fr` et `www.letapeduberry.fr` : les chemins canoniques et `.html` sont couverts.
- Politique « Propriétaire uniquement » : Allow avec une seule adresse exacte, conservée dans la configuration privée. Aucun Everyone, domaine entier ou Bypass.
- Fournisseur One-time PIN ajouté par le titulaire ; application limitée à ce seul fournisseur. Acceptation de tous les fournisseurs désactivée ; connexion Cloudflare One Client désactivée.
- Issuer et audience conservés dans le fichier privé local pour les contrôles serveur.
- La route de contact reste indépendante. Garder `workers_dev = false` et protéger toute URL de prévisualisation éventuelle.

## Vérifications réalisées

Cloudflare confirme « Application configurée avec succès ». Une nouvelle visite déconnectée de `/gestion.html` affiche uniquement le formulaire Email / Send login code pour cette application.

Contrôle réseau : accueil HTTP 200 ; contact redirection canonique sans Access ; `/gestion`, `/gestion.html`, `/api/admin/stays` redirigent HTTP 302 vers Access. `www` ne résout pas actuellement depuis cet ordinateur ; ses destinations sont néanmoins enregistrées.

La fiche de politique a été relue : Allow, une seule règle E-mails avec l’adresse exacte du propriétaire. Les contrôles serveur locaux vérifient indépendamment signature, issuer, audience, expiration et e-mail ; ils refusent les jetons absents, falsifiés, non encore valides et les échecs de récupération des certificats.

## Vérifications restant avant publication

Le 10 octobre, la connexion par code e-mail dans Safari aboutit à `https://letapeduberry.fr/api/admin/health`. Le diagnostic reconnaît la base, les informations contractuelles, l’accès propriétaire, la configuration d’envoi, les calendriers et les paramètres d’arrivée. Cela vérifie la configuration, sans prouver une livraison d’e-mail ni un paiement réel. Les deux indicateurs d’activation des demandes et paiements restent à false.

Correction enregistrée par le propriétaire : cookie de redirection anticipée désactivé. Son activation provoquait un passage par `www.letapeduberry.fr`, qui ne résout pas, pendant la connexion. La politique d’identité et la durée de session restent identiques. Capture : `output/diagnostic-proprietaire-connecte.png`.

Tester ensuite le refus d’une identité différente et les opérations de gestion une fois les routes correspondantes publiées avec l’accord du propriétaire.

Les essais locaux utilisent une identité simulée pour permettre le parcours de démonstration. Ils ne prouvent pas une connexion effective du propriétaire à Cloudflare. Les demandes réelles restent désactivées jusqu’aux essais complets et à l’accord du propriétaire.

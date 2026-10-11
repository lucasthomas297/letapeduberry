# Contact : activation Cloudflare

Le formulaire envoie à `/api/contact`. Le Worker dédié reçoit les coordonnées et le message, vérifie les champs et limite les tentatives à trois par minute et par IP/localisation Cloudflare. La clé n'est jamais exposée dans le navigateur. La réponse positive signifie que Resend a accepté l'e-mail, pas une garantie de remise dans la boîte.

Le **sous-domaine d'envoi** `messages.letapeduberry.fr` est vérifié dans Resend et ses enregistrements ont été ajoutés dans Cloudflare. La boîte de réception utilise désormais OVH ; ses MX et son SPF sont distincts du sous-domaine Resend. Le destinataire est fixé à `contact@letapeduberry.fr` et Répondre adresse la réponse au client.

Le Worker `letapeduberry-contact` est déployé sur `/api/contact`, avec `CONTACT_FROM` et la liaison `CONTACT_RATE_LIMITER` (namespace 1001, trois requêtes par minute). Le secret `RESEND_API_KEY` est enregistré dans Cloudflare. Un envoi réel de test le 3 octobre 2026 a obtenu HTTP 200 et `sent: true` : Resend a accepté le message à destination de `contact@letapeduberry.fr`. La remise dans la boîte doit être distinguée de cette acceptation. La configuration `wrangler.contact.toml` ne route que `/api/contact` : le Worker du site existant reste en place. La route www n'est pas incluse car le site actuel utilise le domaine nu.

Les données transitent par Cloudflare, Resend et la messagerie OVH. Compléter la politique de confidentialité du site (responsable, durées de conservation, droits et sous-traitants) avant activation publique. Les tests automatisés ne transmettent aucun e-mail ; un message technique distinct a été envoyé pour vérifier la connexion en production.

Docs : https://resend.com/docs/api-reference/emails/send-email et https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/

# Avis

Les quatre avis fournis restent dans `index.html` pour fonctionner aussi sans JavaScript. Le carrousel permet boutons, flèches du clavier et glissement tactile, sans défilement imposé. Aucune moyenne globale n'est calculée à partir de cette sélection cinq étoiles.

La récupération hebdomadaire n'est **pas raccordée ni planifiée**. Le calendrier iCal ne fournit pas les avis. Il reste à obtenir une source autorisée (outil partenaire/export fourni par l'hôte) avant de configurer une mise à jour. Respecter le texte original, la note vérifiée, le prénom et la date, et dédupliquer les avis. Les changements restent locaux jusqu'à approbation avant publication.


Politique locale du dépôt (10 octobre 2026) : jusqu’à 3 nuits incluses, empreinte standard ; 4 nuits ou plus, dépôt de 300 € en espèces remis lors d’un rendez-vous le jour de l’arrivée, à partir de 17 h 30, et restitué en personne le jour du départ. Accès autonome et arrivée anticipée conservés. Appliquer la migration 0011 avant déploiement, avec sauvegarde et contrôle des tables. Protéger également `/api/admin/cash-deposit` via Access. Les reçus du dépôt sont séparés du règlement du séjour.

`STRIPE_EXTENDED_AUTHORIZATION_ENABLED` reste false : les nouvelles réservations utilisent les empreintes standards sans demander cette fonctionnalité. Les anciens contrats établis avec une empreinte prolongée restent protégés par ce contrôle. Les essais en environnement test ont renvoyé un refus ; cela ne constitue pas une décision d’inéligibilité du compte réel. La durée réelle de chaque carte demeure contrôlée avant transmission du code ; ne pas promettre 30 jours universels.

## Essai propriétaire sur le site réel

Migration 0013 : chaque dossier porte `payment_test` (0 par défaut), immuable après acceptation. Aucun champ public ni paramètre d’URL ne choisit le mode bancaire. Sur `/gestion`, l’action privée `POST /api/admin/payment-test` exige Access, une origine identique, une demande par carte encore en attente et l’adresse exacte `OWNER_EMAIL`. Le bouton apparaît seulement quand la connexion de test est complète.

Le Worker conserve la clé réelle. Deux secrets distincts, `STRIPE_TEST_SECRET_KEY` (préfixe sk_test/rk_test) et `STRIPE_TEST_WEBHOOK_SECRET`, plus `OWNER_PAYMENT_TEST_ENABLED=true`, raccordent le bac à sable Stripe. La destination de test doit envoyer `checkout.session.completed` et `checkout.session.expired` à `https://letapeduberry.fr/api/stripe/webhook-test`. La destination réelle reste inchangée. Tous les appels de paiement, garantie, contrôle et remboursement sélectionnent les accès d’après le dossier enregistré, sans repli vers la clé réelle. Notifications réelles et de test ne peuvent pas confirmer un dossier de l’autre mode.

Créer une demande habituelle avec l’adresse propriétaire, choisir « Utiliser Stripe en mode test » AVANT « Accepter la demande », puis suivre le lien reçu par e-mail. Utiliser exclusivement une carte de test officielle Stripe (4242 4242 4242 4242, date future, CVC fictif). Le contrat et les e-mails suivent le parcours habituel, les e-mails postérieurs au choix portent TEST. Les dates sont réellement bloquées et exportées vers Airbnb et Booking. Annuler le séjour après l’essai pour les libérer ; remboursement simulé avec la même clé de test. Ne pas déclarer ces nuits fictives à la taxe de séjour.

Contrôles : `node --test services/test-*.mjs`, dont le parcours test Checkout → notification signée → e-mail et deux PDF → calendrier → annulation/remboursement → libération du calendrier ; refus d’un accès anonyme, d’un voyageur tiers, d’une origine tierce, d’une signature erronée et d’un mélange des modes. Ils utilisent des réponses Stripe simulées et ne remplacent pas l’essai interactif réel dans le bac à sable.

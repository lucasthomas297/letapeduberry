# Essai complet avant publication

Demande du propriétaire du 4 octobre 2026 : aucune publication du parcours de réservation avant un essai complet par Lucas, comme un voyageur, en local et son accord.

Le serveur `local-booking-preview.mjs` écoute exclusivement sur `127.0.0.1:8773`. Il utilise les véritables fonctions du parcours avec une base SQLite séparée dans `work/private/local-booking-preview.sqlite`. Aucun envoi Resend n'a lieu : les messages et pièces jointes sont capturés dans cette base privée et présentés dans `/essai.html`. Les calendriers externes sont remplacés par des calendriers vides. Les séjours approuvés dans l'essai bloquent leurs dates localement.

Le serveur exige la clé privée Stripe **test** et la configuration du loueur, toutes deux ignorées par Git. Le paiement utilise réellement Stripe en mode test. Les retours de Checkout pointent vers l'ordinateur local. La confirmation est vérifiée via l'API authentifiée Stripe ; le simple retour du navigateur ne prouve jamais le paiement. Aucun montant réel n'est débité. Aucune configuration publique n'est modifiée.

Le contrat en projet est autorisé uniquement dans la configuration en mémoire de ce serveur d'essai ; `wrangler.reservation.toml` garde `CONTRACT_APPROVED=false` et `REQUESTS_ENABLED=false`. Le serveur ne doit jamais être exposé par un tunnel ni être utilisé comme hébergement public. L'accès propriétaire local est réservé à cet essai, avec un jeton signé éphémère, sans modifier la protection Access du service déployable.

## Parcours à essayer

1. Ouvrir `http://127.0.0.1:8773/index.html#demande`, choisir les dates, le tarif et les options. Utiliser des coordonnées fictives et cocher les trois engagements. Envoyer la demande.
2. Ouvrir `http://127.0.0.1:8773/essai.html` : lire l'accusé de réception voyageur et la notification propriétaire.
3. Ouvrir l'espace propriétaire et accepter la demande. Vérifier le prix et le délai de 12 heures.
4. Revenir aux messages de l'essai et ouvrir le lien du contrat dans le message d'acceptation.
5. Lire/télécharger le projet de contrat, saisir le même nom, accepter le contrat et le dépôt, puis ouvrir Stripe test.
6. Carte `4242 4242 4242 4242`, expiration future, code à trois chiffres. Terminer le paiement soi-même. Vérifier la page de confirmation au retour.
7. Vérifier le message de confirmation dans la boîte locale et ouvrir le contrat/règlement joint. Vérifier aussi le statut confirmé dans l'espace propriétaire.
8. Essayer séparément un refus, un paiement interrompu et une carte de test refusée. Ne pas appeler cela une confirmation avant paiement.

Cet essai valide le parcours local et l'intégration Stripe test. Il ne valide pas encore la réception dans OVH, le webhook public, les disponibilités réelles des plateformes, la configuration Access/D1 ni le déclenchement de la garantie 48 heures avant l'arrivée. Ces éléments et le contrat définitif restent à vérifier avant toute activation publique.

Lancer avec le runtime Node fourni : `node services/local-booking-preview.mjs`. Ne pas copier la clé Stripe dans les arguments ou dans ce document. Les fichiers privés ne sont pas servis par le serveur.

## Contrôle des PDF avant décision

Dans `gestion.html`, chaque demande propose « Voir le contrat PDF » et « Voir la fiche descriptive PDF ». Accès propriétaire authentifié, lecture seule, aucun e-mail ni changement de statut. Avant acceptation : génération depuis les données de la demande. Après acceptation : document archivé, avec les consentements réellement enregistrés. La fiche est masquée pour les anciens contrats sans annexe archivée. Paiement, coordonnées, dates, horaires optionnels, montant et conditions du tarif sont propres au séjour.

## Essai espèces

Choisir « En espèces à l’arrivée » dans une nouvelle demande. Après accord du propriétaire, lire le message d’essai, accepter les deux cases puis « Accepter et confirmer mon séjour ». Aucune session de paiement Stripe du séjour. Les deux PDF figurent dans le message de confirmation. Dans la gestion, utiliser « Enregistrer le règlement en espèces », confirmer la réception intégrale ; le reçu est conservé dans les messages d’essai. Aucune somme ni aucun e-mail réel dans cet essai.

## Calendriers réels et messages locaux

Lancer avec BERRY_REAL_CALENDARS=true pour utiliser les liens privés Airbnb et Booking. Ces flux sont consultés en lecture seule ; les séjours fictifs ne sont jamais exportés vers les plateformes. La page /essai-calendriers.html montre les périodes fusionnées. Les messages automatiques sont activés uniquement dans cet essai intercepté, avec un code de boîte à clés fictif « CODE D’EXEMPLE ». Le vrai code ne doit pas être mis dans les sources. En ligne, GUEST_MESSAGES_ENABLED reste false jusqu’à validation et déploiement.

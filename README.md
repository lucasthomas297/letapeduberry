# L’Étape du Berry

Site de présentation et de demande de séjour pour l’appartement L’Étape du Berry à Bourges.

Les pages HTML et les ressources du dossier `assets/` constituent le site. `booking_server.py` contient le serveur de réservation en préparation, avec synchronisation iCal et intégration Stripe. Les liens de calendriers, les accès e-mail et les clés Stripe doivent être fournis par variables d’environnement lors du déploiement ; ils ne figurent pas dans ce dépôt.

Le site, le formulaire Contact et le parcours de réservation sont en ligne. Les demandes sont validées manuellement par le propriétaire ; Stripe traite les paiements réels. Un mode Stripe fictif est réservé aux essais du propriétaire. Voir services/README.md pour les réglages de réservation et la mise à jour hebdomadaire des avis.

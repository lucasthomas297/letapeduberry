# Parcours de réservation proposé — préparation locale

La validation de chaque demande par Lucas est manuelle. Le module Python de réservation n'est pas déployé sur Cloudflare ; Stripe n'est pas raccordé et aucun paiement/empreinte réel n'a été créé.

1. Le voyageur choisit les dates, 1 ou 2 personnes, le tarif et ses options. Le serveur vérifie les dates et recalcule le montant.
2. Le voyageur fournit ses coordonnées et coche une case vide par défaut : acceptation du règlement avec lien dans un nouvel onglet. Le serveur refuse l'absence d'acceptation. La version du règlement et la date UTC sont enregistrées. Copie de référence : `services/rules/2026-10-03.html`. Toute modification du règlement doit changer RULES_VERSION et conserver une nouvelle copie.
3. La demande reste en attente, sans prélèvement. Notification à l'hôte et accusé de réception à connecter.
4. L'hôte vérifie les disponibilités, bloque les dates sur les plateformes, puis approuve. La synchronisation iCal n'offre pas un verrou instantané commun ; ne pas annoncer de réservation instantanée garantie avec cette seule intégration.
5. Le serveur crée une session Stripe pour le paiement du séjour approuvé, avec une échéance et un identifiant propre. Vérification par webhook signé et traitement idempotent. Distinguer explicitement paiement de séjour et caution via metadata[purpose].
6. La confirmation du séjour suit le paiement accepté (ou la procédure espèces à définir) ; l'approbation seule ne vaut pas paiement. Les liens de retour ne sont pas des preuves de paiement.

## Dépôt de garantie : 300 €

L'empreinte est distincte du prix du séjour. `deposit_checkout_fields` prépare une session carte de 300 € avec capture manuelle. La création d'une session n'effectue ni empreinte ni débit : le client doit compléter l'autorisation sur Stripe. Deux clés d'idempotence séparent séjour et dépôt.

Avant activation, intégrer les étapes suivantes :

- Informer le voyageur du montant, du moment de l'empreinte, de la procédure en cas de dommages et de sa libération. Faire accepter les conditions du dépôt avant l'autorisation. Le règlement accepté aujourd'hui ne contient PAS encore ces nouvelles conditions ; ne pas traiter cette case comme une autorisation de débiter une caution.
- Envoyer le lien de caution près de l'arrivée ; contrôler `requires_capture`, le montant EUR 300 et `latest_charge.payment_method_details.card.capture_before`. Enregistrer les identifiants, statuts et échéances séparément. La date réelle renvoyée par Stripe fait foi.
- Si l'échéance ne couvre pas le séjour et le contrôle de sortie, ne pas considérer le dépôt garanti : vérifier l'éligibilité aux autorisations prolongées ou demander une nouvelle autorisation selon une procédure annoncée au client. Une carte enregistrée n'est pas une garantie de fonds disponibles.
- Sans dommages : annuler l'autorisation rapidement après vérification ; le délai d'affichage/libération dépend de la banque.
- En cas de dommages : décision manuelle de l'hôte, justificatifs et information du voyageur ; capturer uniquement le montant justifié, au maximum 300 €, avant expiration. Ne pas prévoir un débit automatique sur simple signalement. Une capture partielle libère normalement le reste.
- Une annulation du séjour doit traiter aussi la caution, sans libération indéfiniment en attente. Webhooks à tester pour expiration, refus, authentification supplémentaire et événements dupliqués.

À développer : page paiement et retour, administration authentifiée des demandes, webhooks, stockage du suivi des cautions, notifications et essais complets en mode test. Ne pas déployer les simples fonctions de préparation comme un système complet de réservation.

Référence Stripe : https://docs.stripe.com/payments/place-a-hold-on-a-payment-method

# Contact : activation Cloudflare

Le formulaire envoie à `/api/contact`. Le Worker dédié reçoit les coordonnées et le message, vérifie les champs et limite les tentatives à trois par minute et par IP/localisation Cloudflare. La clé n'est jamais exposée dans le navigateur. La réponse positive signifie que Resend a accepté l'e-mail, pas une garantie de remise dans la boîte.

Le **sous-domaine d'envoi** `messages.letapeduberry.fr` est vérifié dans Resend et ses enregistrements ont été ajoutés dans Cloudflare. Les MX Lark et le SPF du domaine principal sont conservés. Le destinataire est fixé à `contact@letapeduberry.fr` et Répondre adresse la réponse au client.

Le Worker `letapeduberry-contact` est déployé sur `/api/contact`, avec `CONTACT_FROM` et la liaison `CONTACT_RATE_LIMITER` (namespace 1001, trois requêtes par minute). Le secret `RESEND_API_KEY` est enregistré dans Cloudflare. Un envoi réel de test le 3 octobre 2026 a obtenu HTTP 200 et `sent: true` : Resend a accepté le message à destination de `contact@letapeduberry.fr`. La remise dans la boîte doit être distinguée de cette acceptation. La configuration `wrangler.contact.toml` ne route que `/api/contact` : le Worker du site existant reste en place. La route www n'est pas incluse car le site actuel utilise le domaine nu.

Les données transitent par Cloudflare, Resend et la messagerie Lark. Compléter la politique de confidentialité du site (responsable, durées de conservation, droits et sous-traitants) avant activation publique. Les tests automatisés ne transmettent aucun e-mail ; un message technique distinct a été envoyé pour vérifier la connexion en production.

Docs : https://resend.com/docs/api-reference/emails/send-email et https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/

# Avis

Les quatre avis fournis restent dans `index.html` pour fonctionner aussi sans JavaScript. Le carrousel permet boutons, flèches du clavier et glissement tactile, sans défilement imposé. Aucune moyenne globale n'est calculée à partir de cette sélection cinq étoiles.

La récupération hebdomadaire n'est **pas raccordée ni planifiée**. Le calendrier iCal ne fournit pas les avis. Il reste à obtenir une source autorisée (outil partenaire/export fourni par l'hôte) avant de configurer une mise à jour. Respecter le texte original, la note vérifiée, le prénom et la date, et dédupliquer les avis. Les changements restent locaux jusqu'à approbation avant publication.

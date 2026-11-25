# Stockage de la garde-robe

Les skins importés restent dans `.honor&magic/skin`. Le fichier `collection.json`
conserve les noms, favoris, sélection et réglages du compte comme auparavant.

Sous Windows, le launcher lui applique l’attribut « caché » à l’ouverture de la
garde-robe et après chaque sauvegarde. Il reste accessible si l’affichage des
éléments cachés est activé dans l’Explorateur. Aucun PNG technique n’est créé.
Sur les autres systèmes, le nom et la visibilité du JSON restent inchangés.

Un échec de modification de l’attribut est journalisé sans empêcher la sauvegarde.

Vérification : `node --test test/skinlibrary.test.js`.

## Skins standards et HD

La garde-robe accepte les PNG de largeur 64, 128, 256, 512 ou 1024 pixels,
avec une hauteur égale à la largeur (format moderne) ou à sa moitié
(ancien format). La limite de fichier est de 16 Mo.

Les PNG importés sont conservés à leur résolution originale. Les aperçus
de l’accueil et de la garde-robe, les miniatures et la conversion des bras
utilisent cette résolution, y compris pour les anciens formats rectangulaires.

L’envoi au compte Minecraft passe toujours par le service officiel : une copie
de largeur 64 pixels est préparée en mémoire pour les skins HD, sans modifier
le PNG enregistré. Le launcher n’envoie pas encore les textures HD à un mod.
Leur utilisation en jeu à pleine résolution nécessitera une intégration adaptée
au mod ou au service retenu.

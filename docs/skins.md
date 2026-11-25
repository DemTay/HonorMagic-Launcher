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

La garde-robe accepte les PNG classiques de 64 × 32 ou 64 × 64 pixels et
les PNG HD de 128 × 64 ou 128 × 128 pixels. La limite de fichier reste de 16 Mo.

Les PNG importés sont conservés à leur résolution originale. Les aperçus
de l’accueil et de la garde-robe, les miniatures et la conversion des bras
utilisent cette résolution, y compris pour les anciens formats rectangulaires.

Les skins classiques utilisent toujours le compte Minecraft. Sans l’addon HD
dans la distribution, le launcher utilise aussi l’ancien parcours pour les
skins HD : envoi d’une copie réduite à 64 pixels, sans modifier l’original.

## Relais HD multijoueur — Forge 1.12.2

Compiler `mods/hd-skin-relay` avec Java 8 et Gradle 4.9 :

```sh
gradle -p mods/hd-skin-relay build
```

Installer `HonorMagicSkins-1.0.0.jar` dans les mods du serveur Forge et le
déclarer comme `ForgeMod` obligatoire dans la distribution client, avec
l’identifiant `net.demtay.mods:honormagicskins:1.0.0@jar`. Le mod est autonome :
il n’intègre ni MorePlayerModels, ni son menu F12, ni son éditeur en jeu.
La personnalisation reste dans la garde-robe du launcher.

Sur l’instance Honor & Magic, le launcher prépare uniquement le PNG sélectionné
et le remet au client Java. Celui-ci attend l’accord de l’addon sur le serveur
configuré, puis transfère la texture sans réduction. Le serveur la garde en
mémoire pendant la connexion et l’envoie aux clients équipés qui suivent le
joueur. Le transfert est étalé sur plusieurs ticks, sans stockage serveur ni
publication web. Les clients non équipés continuent de voir le skin du compte.
Le retour à un skin classique passe par le compte Minecraft au prochain
lancement et ne diffuse aucune texture HD.

Le relais accepte uniquement les PNG HD carrés de 128 × 128 pixels.
Le format 128 × 64 est converti en carré sans réduire sa largeur. Les skins
plus grands déjà importés restent dans la garde-robe sans être modifiés et
utilisent en jeu une copie standard de 64 pixels via le compte Minecraft.

### Remplacer l’ancien JAR fusionné

Le résultat du build se trouve dans `mods/hd-skin-relay/build/libs/`.
Remplacer l’ancien JAR fusionné côté serveur et dans le dossier web des mods,
puis mettre à jour la taille et le MD5 dans le manifeste client. Si un JAR
MorePlayerModels séparé est encore chargé, le retirer : sinon son menu reste
disponible. Les anciens profils MorePlayerModels sur disque ne sont pas effacés.

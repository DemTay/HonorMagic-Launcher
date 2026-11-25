package fr.honormagic.skins;

import com.mojang.authlib.minecraft.MinecraftProfileTexture;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.MemoryCacheImageInputStream;
import net.minecraft.client.Minecraft;
import net.minecraft.client.network.NetworkPlayerInfo;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.util.ResourceLocation;
import net.minecraftforge.client.event.RenderPlayerEvent;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.fml.common.ObfuscationReflectionHelper;
import net.minecraftforge.fml.common.eventhandler.EventPriority;
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent;
import net.minecraftforge.fml.common.gameevent.TickEvent;
import net.minecraftforge.fml.common.network.FMLNetworkEvent;
import org.apache.logging.log4j.LogManager;

public final class ClientRelay extends HonorMagicSkins.Proxy {
    private static final MinecraftProfileTexture.Type SKIN = MinecraftProfileTexture.Type.SKIN;
    private static final Field TEXTURES = playerField("field_187107_a", "playerTextures");
    private static final Field TYPE = playerField("field_178863_g", "skinType");
    private final Map<UUID, SkinTransfer> incoming = new HashMap<>();
    private final Map<UUID, Texture> textures = new HashMap<>();
    private final ThreadPoolExecutor decoder = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(8), work -> {
                Thread thread = new Thread(work, "HonorMagic skin decoder");
                thread.setDaemon(true);
                return thread;
            });
    private byte[] upload;
    private int offset;
    private boolean slim;
    private boolean offered;

    @Override
    void init() {
        MinecraftForge.EVENT_BUS.register(this);
    }

    @Override
    void receive(HonorMagicSkins.Download message) {
        if (message.owner == null || message.bytes == null) return;
        Minecraft.getMinecraft().addScheduledTask(() -> receiveOnClient(message));
    }

    private void receiveOnClient(HonorMagicSkins.Download message) {
        if (message.total == -1) {
            offerLocalSkin();
            return;
        }
        UUID owner = message.owner;
        if (message.total == 0) {
            incoming.remove(owner);
            removeTexture(owner);
            return;
        }
        if (!SkinTransfer.validTotal(message.total)) return;
        SkinTransfer transfer = incoming.computeIfAbsent(owner, key -> new SkinTransfer(message.total, message.slim));
        if (!transfer.append(message.total, message.slim, message.bytes)) {
            incoming.remove(owner);
            return;
        }
        byte[] bytes = transfer.take();
        if (bytes == null) return;
        try {
            decoder.execute(() -> decode(owner, transfer, bytes));
        } catch (RejectedExecutionException error) {
            incoming.remove(owner);
            LogManager.getLogger(HonorMagicSkins.ID).warn("HD skin decoder busy.");
        }
    }

    private static String address(String value) {
        return value.trim().toLowerCase(Locale.ROOT).replaceFirst(":25565$", "");
    }

    private void offerLocalSkin() {
        if (offered) return;
        offered = true;
        Minecraft game = Minecraft.getMinecraft();
        String expected = System.getenv("HM_HD_SKIN_SERVER");
        if (!game.isSingleplayer() && (expected == null || game.getCurrentServerData() == null
                || !address(expected).equals(address(game.getCurrentServerData().serverIP)))) return;
        String filename = System.getenv("HM_HD_SKIN_FILE");
        if (filename == null) return;
        try {
            Path file = Paths.get(filename);
            if (!Files.isRegularFile(file) || Files.size(file) > SkinTransfer.MAX_BYTES) return;
            byte[] bytes = Files.readAllBytes(file);
            if (!SkinTransfer.validTotal(bytes.length) || !SkinTransfer.validHeader(bytes)) return;
            upload = bytes;
            offset = 0;
            slim = "slim".equals(System.getenv("HM_HD_SKIN_VARIANT"));
            file.toFile().deleteOnExit();
        } catch (IOException error) {
            LogManager.getLogger(HonorMagicSkins.ID).warn("Could not read the local HD skin.", error);
        }
    }

    private void decode(UUID owner, SkinTransfer transfer, byte[] bytes) {
        BufferedImage image = null;
        ImageReader reader = ImageIO.getImageReadersByFormatName("png").next();
        try (MemoryCacheImageInputStream stream = new MemoryCacheImageInputStream(new ByteArrayInputStream(bytes))) {
            reader.setInput(stream, true, true);
            image = reader.read(0);
        } catch (IOException | RuntimeException error) {
            LogManager.getLogger(HonorMagicSkins.ID).warn("Invalid HD skin received.");
        } finally {
            reader.dispose();
        }
        BufferedImage decoded = image;
        Minecraft.getMinecraft().addScheduledTask(() -> {
            if (incoming.get(owner) != transfer) return;
            incoming.remove(owner);
            if (decoded == null) return;
            removeTexture(owner);
            ResourceLocation location = new ResourceLocation(HonorMagicSkins.ID, "skins/" + owner);
            Minecraft.getMinecraft().getTextureManager().loadTexture(location, new DynamicTexture(decoded));
            textures.put(owner, new Texture(location, transfer.slim ? "slim" : "default"));
            applyTexture(owner);
        });
    }

    @SubscribeEvent
    public void tick(TickEvent.ClientTickEvent event) {
        if (event.phase != TickEvent.Phase.END || Minecraft.getMinecraft().getConnection() == null) return;
        if (upload != null) {
            for (int count = 0; count < 3 && upload != null; count++) {
                int end = Math.min(offset + SkinTransfer.CHUNK, upload.length);
                HonorMagicSkins.NETWORK.sendToServer(new HonorMagicSkins.Upload(
                        upload.length, slim, Arrays.copyOfRange(upload, offset, end)));
                offset = end;
                if (end == upload.length) upload = null;
            }
        }
        textures.keySet().forEach(this::applyTexture);
    }

    @SubscribeEvent(priority = EventPriority.LOWEST)
    public void render(RenderPlayerEvent.Pre event) {
        applyTexture(event.getEntityPlayer().getUniqueID());
    }

    @SubscribeEvent
    public void disconnect(FMLNetworkEvent.ClientDisconnectionFromServerEvent event) {
        Minecraft.getMinecraft().addScheduledTask(() -> {
            upload = null;
            offered = false;
            incoming.clear();
            decoder.getQueue().clear();
            for (UUID owner : new ArrayList<>(textures.keySet())) removeTexture(owner);
        });
    }

    private void applyTexture(UUID owner) {
        Texture texture = textures.get(owner);
        Minecraft game = Minecraft.getMinecraft();
        if (texture == null || game.getConnection() == null) return;
        NetworkPlayerInfo info = game.getConnection().getPlayerInfo(owner);
        if (info == null) return;
        try {
            Map<MinecraftProfileTexture.Type, ResourceLocation> map = skinMap(info);
            ResourceLocation current = map.get(SKIN);
            String skinType = (String) TYPE.get(info);
            if (texture.info != info) {
                texture.info = info;
                texture.previous = current;
                texture.previousType = skinType;
            }
            if (!texture.location.equals(current)) {
                texture.previous = current;
                map.put(SKIN, texture.location);
            }
            if (!texture.type.equals(skinType)) {
                texture.previousType = skinType;
                TYPE.set(info, texture.type);
            }
        } catch (IllegalAccessException error) {
            throw new IllegalStateException("Could not apply HD skin.", error);
        }
    }

    private void removeTexture(UUID owner) {
        Texture texture = textures.remove(owner);
        if (texture == null) return;
        Minecraft.getMinecraft().getTextureManager().deleteTexture(texture.location);
        if (texture.info == null) return;
        try {
            Map<MinecraftProfileTexture.Type, ResourceLocation> map = skinMap(texture.info);
            if (texture.location.equals(map.get(SKIN))) {
                if (texture.previous == null) map.remove(SKIN);
                else map.put(SKIN, texture.previous);
                if (texture.type.equals(TYPE.get(texture.info))) TYPE.set(texture.info, texture.previousType);
            }
        } catch (IllegalAccessException error) {
            throw new IllegalStateException("Could not restore player skin.", error);
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<MinecraftProfileTexture.Type, ResourceLocation> skinMap(NetworkPlayerInfo info) throws IllegalAccessException {
        return (Map<MinecraftProfileTexture.Type, ResourceLocation>) TEXTURES.get(info);
    }

    private static Field playerField(String mapped, String developmentName) {
        try {
            Field field = NetworkPlayerInfo.class.getDeclaredField(developmentName);
            field.setAccessible(true);
            return field;
        } catch (NoSuchFieldException ignored) {
            return ObfuscationReflectionHelper.findField(NetworkPlayerInfo.class, mapped);
        }
    }

    private static final class Texture {
        final ResourceLocation location;
        final String type;
        NetworkPlayerInfo info;
        ResourceLocation previous;
        String previousType;

        Texture(ResourceLocation location, String type) {
            this.location = location;
            this.type = type;
        }
    }
}

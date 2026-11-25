package fr.honormagic.skins;

import io.netty.buffer.ByteBuf;
import io.netty.util.AttributeKey;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import net.minecraft.entity.player.EntityPlayerMP;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.common.SidedProxy;
import net.minecraftforge.fml.common.event.FMLInitializationEvent;
import net.minecraftforge.fml.common.event.FMLServerStoppedEvent;
import net.minecraftforge.fml.common.network.NetworkCheckHandler;
import net.minecraftforge.fml.common.network.NetworkRegistry;
import net.minecraftforge.fml.common.network.simpleimpl.IMessage;
import net.minecraftforge.fml.common.network.simpleimpl.SimpleNetworkWrapper;
import net.minecraftforge.fml.relauncher.Side;

@Mod(modid = HonorMagicSkins.ID, name = "Honor & Magic HD Skins", version = HonorMagicSkins.VERSION,
        acceptedMinecraftVersions = "[1.12.2]")
public final class HonorMagicSkins {
    static final String ID = "honormagicskins";
    static final String VERSION = "1.0.0";
    static final SimpleNetworkWrapper NETWORK = NetworkRegistry.INSTANCE.newSimpleChannel(ID);
    static final ServerRelay SERVER = new ServerRelay();
    private static final AttributeKey<AtomicInteger> PENDING = AttributeKey.valueOf(ID + ":pending");

    @SidedProxy(clientSide = "fr.honormagic.skins.ClientRelay", serverSide = "fr.honormagic.skins.HonorMagicSkins$Proxy")
    public static Proxy proxy;

    @NetworkCheckHandler
    public boolean accepts(Map<String, String> remoteMods, Side side) {
        return !remoteMods.containsKey(ID) || VERSION.equals(remoteMods.get(ID));
    }

    @Mod.EventHandler
    public void init(FMLInitializationEvent event) {
        NETWORK.registerMessage((message, context) -> {
            if (message.bytes == null || !SkinTransfer.validTotal(message.total) || message.bytes.length == 0) return null;
            EntityPlayerMP player = context.getServerHandler().player;
            io.netty.util.Attribute<AtomicInteger> slot = player.connection.netManager.channel().attr(PENDING);
            AtomicInteger pending = slot.get();
            if (pending == null) {
                slot.setIfAbsent(new AtomicInteger());
                pending = slot.get();
            }
            AtomicInteger count = pending;
            if (count.incrementAndGet() > 12) {
                count.decrementAndGet();
                return null;
            }
            player.getServerWorld().addScheduledTask(() -> {
                try {
                    SERVER.receive(player, message);
                } finally {
                    count.decrementAndGet();
                }
            });
            return null;
        }, Upload.class, 0, Side.SERVER);
        NETWORK.registerMessage((message, context) -> {
            proxy.receive(message);
            return null;
        }, Download.class, 1, Side.CLIENT);
        MinecraftForge.EVENT_BUS.register(SERVER);
        proxy.init();
    }

    @Mod.EventHandler
    public void stopped(FMLServerStoppedEvent event) {
        SERVER.reset();
    }

    public static class Proxy {
        void init() {}
        void receive(Download message) {}
    }

    public static class Upload implements IMessage {
        int total;
        boolean slim;
        byte[] bytes;

        public Upload() {}

        Upload(int total, boolean slim, byte[] bytes) {
            this.total = total;
            this.slim = slim;
            this.bytes = bytes;
        }

        @Override
        public void fromBytes(ByteBuf buffer) {
            if (buffer.readableBytes() < 5 || buffer.readableBytes() > 5 + SkinTransfer.CHUNK) {
                buffer.skipBytes(buffer.readableBytes());
                return;
            }
            total = buffer.readInt();
            slim = buffer.readBoolean();
            bytes = new byte[buffer.readableBytes()];
            buffer.readBytes(bytes);
        }

        @Override
        public void toBytes(ByteBuf buffer) {
            buffer.writeInt(total);
            buffer.writeBoolean(slim);
            buffer.writeBytes(bytes);
        }
    }

    public static final class Download extends Upload {
        UUID owner;

        public Download() {}

        Download(UUID owner, int total, boolean slim, byte[] bytes) {
            super(total, slim, bytes);
            this.owner = owner;
        }

        @Override
        public void fromBytes(ByteBuf buffer) {
            if (buffer.readableBytes() < 16) {
                buffer.skipBytes(buffer.readableBytes());
                return;
            }
            owner = new UUID(buffer.readLong(), buffer.readLong());
            super.fromBytes(buffer);
        }

        @Override
        public void toBytes(ByteBuf buffer) {
            buffer.writeLong(owner.getMostSignificantBits());
            buffer.writeLong(owner.getLeastSignificantBits());
            super.toBytes(buffer);
        }
    }
}

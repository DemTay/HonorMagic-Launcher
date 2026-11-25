package fr.honormagic.skins;

import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import net.minecraft.entity.player.EntityPlayerMP;
import net.minecraftforge.event.entity.player.PlayerEvent;
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent;
import net.minecraftforge.fml.common.gameevent.TickEvent;
import net.minecraftforge.fml.common.network.handshake.NetworkDispatcher;

public final class ServerRelay {
    private static final byte[] EMPTY = new byte[0];
    private static final int CHUNKS_PER_TICK = 8;

    private final Map<UUID, Peer> peers = new HashMap<>();
    private final Map<UUID, Set<EntityPlayerMP>> watchers = new HashMap<>();
    private final Deque<Delivery> queue = new ArrayDeque<>();

    private static boolean supportsRelay(EntityPlayerMP player) {
        NetworkDispatcher dispatcher = NetworkDispatcher.get(player.connection.netManager);
        return player.connection.netManager.isLocalChannel() || dispatcher != null
                && HonorMagicSkins.VERSION.equals(dispatcher.getModList().get(HonorMagicSkins.ID));
    }

    @SubscribeEvent
    public void login(net.minecraftforge.fml.common.gameevent.PlayerEvent.PlayerLoggedInEvent event) {
        if (!(event.player instanceof EntityPlayerMP)) return;
        EntityPlayerMP player = (EntityPlayerMP) event.player;
        if (!supportsRelay(player)) return;
        UUID owner = player.getUniqueID();
        peers.put(owner, new Peer());
        HonorMagicSkins.NETWORK.sendTo(new HonorMagicSkins.Download(owner, -1, false, EMPTY), player);
    }

    @SubscribeEvent
    public void logout(net.minecraftforge.fml.common.gameevent.PlayerEvent.PlayerLoggedOutEvent event) {
        if (!(event.player instanceof EntityPlayerMP)) return;
        UUID owner = event.player.getUniqueID();
        Peer peer = peers.remove(owner);
        queue.removeIf(delivery -> delivery.owner.equals(owner) || delivery.viewer == event.player);
        Set<EntityPlayerMP> viewers = watchers.remove(owner);
        if (viewers != null && peer != null && peer.skin != null) {
            for (EntityPlayerMP viewer : viewers) clear(owner, viewer);
        }
        watchers.values().removeIf(players -> {
            players.remove(event.player);
            return players.isEmpty();
        });
    }

    @SubscribeEvent
    public void startTracking(PlayerEvent.StartTracking event) {
        if (!(event.getEntityPlayer() instanceof EntityPlayerMP) || !(event.getTarget() instanceof EntityPlayerMP)) return;
        EntityPlayerMP viewer = (EntityPlayerMP) event.getEntityPlayer();
        if (!supportsRelay(viewer)) return;
        UUID owner = event.getTarget().getUniqueID();
        if (owner.equals(viewer.getUniqueID())) return;
        if (!watchers.computeIfAbsent(owner, key -> new HashSet<>()).add(viewer)) return;
        Peer peer = peers.get(owner);
        if (peer != null && peer.skin != null) queue.add(new Delivery(owner, viewer, peer));
    }

    @SubscribeEvent
    public void stopTracking(PlayerEvent.StopTracking event) {
        if (!(event.getEntityPlayer() instanceof EntityPlayerMP) || !(event.getTarget() instanceof EntityPlayerMP)) return;
        EntityPlayerMP viewer = (EntityPlayerMP) event.getEntityPlayer();
        UUID owner = event.getTarget().getUniqueID();
        Set<EntityPlayerMP> viewers = watchers.get(owner);
        if (viewers == null || !viewers.remove(viewer)) return;
        if (viewers.isEmpty()) watchers.remove(owner);
        queue.removeIf(delivery -> delivery.owner.equals(owner) && delivery.viewer == viewer);
        Peer peer = peers.get(owner);
        if (peer != null && peer.skin != null) clear(owner, viewer);
    }

    private void clear(UUID owner, EntityPlayerMP viewer) {
        HonorMagicSkins.NETWORK.sendTo(new HonorMagicSkins.Download(owner, 0, false, EMPTY), viewer);
    }

    void receive(EntityPlayerMP player, HonorMagicSkins.Upload message) {
        UUID owner = player.getUniqueID();
        Peer peer = peers.get(owner);
        if (peer == null || peer.finished || message.bytes == null) return;
        if (peer.incoming == null) peer.incoming = new SkinTransfer(message.total, message.slim);
        if (!peer.incoming.append(message.total, message.slim, message.bytes)) {
            peer.incoming = null;
            peer.finished = true;
            return;
        }
        peer.skin = peer.incoming.take();
        if (peer.skin == null) return;
        peer.slim = peer.incoming.slim;
        peer.incoming = null;
        peer.finished = true;
        queue.add(new Delivery(owner, player, peer));
        Set<EntityPlayerMP> viewers = watchers.get(owner);
        if (viewers != null) {
            for (EntityPlayerMP viewer : viewers) queue.add(new Delivery(owner, viewer, peer));
        }
    }

    @SubscribeEvent
    public void tick(TickEvent.ServerTickEvent event) {
        if (event.phase != TickEvent.Phase.END) return;
        for (int count = 0; count < CHUNKS_PER_TICK && !queue.isEmpty(); count++) {
            Delivery delivery = queue.remove();
            int end = Math.min(delivery.offset + SkinTransfer.CHUNK, delivery.skin.length);
            byte[] chunk = Arrays.copyOfRange(delivery.skin, delivery.offset, end);
            HonorMagicSkins.NETWORK.sendTo(new HonorMagicSkins.Download(
                    delivery.owner, delivery.skin.length, delivery.slim, chunk), delivery.viewer);
            delivery.offset = end;
            if (end < delivery.skin.length) queue.add(delivery);
        }
    }

    void reset() {
        peers.clear();
        watchers.clear();
        queue.clear();
    }

    private static final class Peer {
        SkinTransfer incoming;
        byte[] skin;
        boolean slim;
        boolean finished;
    }

    private static final class Delivery {
        final UUID owner;
        final EntityPlayerMP viewer;
        final byte[] skin;
        final boolean slim;
        int offset;

        Delivery(UUID owner, EntityPlayerMP viewer, Peer peer) {
            this.owner = owner;
            this.viewer = viewer;
            this.skin = peer.skin;
            this.slim = peer.slim;
        }
    }
}

package fr.honormagic.skins;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.Arrays;

final class SkinTransfer {
    static final int CHUNK = 24 * 1024;
    static final int MAX_BYTES = 16 * 1024 * 1024;
    private static final byte[] PNG = {(byte) 137, 80, 78, 71, 13, 10, 26, 10};

    final int total;
    final boolean slim;
    private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();

    SkinTransfer(int total, boolean slim) {
        this.total = total;
        this.slim = slim;
    }

    static boolean validTotal(int total) {
        return total >= 33 && total <= MAX_BYTES;
    }

    static boolean validHeader(byte[] bytes) {
        if (bytes.length < 33 || !Arrays.equals(PNG, Arrays.copyOf(bytes, PNG.length))) return false;
        ByteBuffer header = ByteBuffer.wrap(bytes);
        if (header.getInt(8) != 13 || header.getInt(12) != 0x49484452) return false;
        return header.getInt(16) == 128 && header.getInt(20) == 128;
    }

    boolean append(int declaredTotal, boolean declaredSlim, byte[] chunk) {
        if (!validTotal(total) || declaredTotal != total || declaredSlim != slim) return false;
        int received = bytes.size();
        if (chunk.length != Math.min(CHUNK, total - received)) return false;
        if (received == 0 && !validHeader(chunk)) return false;
        bytes.write(chunk, 0, chunk.length);
        return true;
    }

    byte[] take() {
        return bytes.size() == total ? bytes.toByteArray() : null;
    }
}

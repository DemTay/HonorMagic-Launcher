package fr.honormagic.skins;

import java.nio.ByteBuffer;
import java.util.Arrays;
import org.junit.Test;

import static org.junit.Assert.*;

public class SkinTransferTest {
    private byte[] png(int length, int width, int height) {
        byte[] bytes = new byte[length];
        ByteBuffer.wrap(bytes).putLong(0x89504e470d0a1a0aL).putInt(13).putInt(0x49484452).putInt(width).putInt(height);
        return bytes;
    }

    @Test
    public void reassemblesTheMaximumResolutionWithoutReducingIt() {
        byte[] bytes = png(SkinTransfer.CHUNK * 2 + 7, 128, 128);
        SkinTransfer transfer = new SkinTransfer(bytes.length, true);
        for (int offset = 0; offset < bytes.length; offset += SkinTransfer.CHUNK) {
            assertNull(transfer.take());
            assertTrue(transfer.append(bytes.length, true,
                    Arrays.copyOfRange(bytes, offset, Math.min(bytes.length, offset + SkinTransfer.CHUNK))));
        }
        assertArrayEquals(bytes, transfer.take());
    }

    @Test
    public void rejectsUnexpectedFramesAndNonPngUploads() {
        assertFalse(SkinTransfer.validTotal(SkinTransfer.MAX_BYTES + 1));
        SkinTransfer transfer = new SkinTransfer(1024, false);
        assertFalse(transfer.append(1024, false, new byte[1024]));
        assertFalse(transfer.append(1024, false, png(1024, 64, 64)));
        assertFalse(transfer.append(1024, false, png(1024, 128, 64)));
        assertFalse(transfer.append(1024, false, png(1024, 128, 256)));
        assertFalse(transfer.append(1024, false, png(1024, 256, 256)));
        assertFalse(transfer.append(1024, true, png(1024, 128, 128)));
        assertFalse(transfer.append(1024, false, png(512, 128, 128)));
        assertNull(transfer.take());
    }
}

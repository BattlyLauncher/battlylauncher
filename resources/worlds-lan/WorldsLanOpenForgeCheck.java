import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

public final class WorldsLanOpenForgeCheck {
    private static final String ROOM = "127.0.0.1:58488";
    private static final String NEXT_ROOM = "127.0.0.1:64719";

    static final class ServerData {
        private final String address;
        private final boolean lan;

        ServerData(String name, String address, boolean lan) {
            this.address = address;
            this.lan = lan;
        }

        String keys() { return "name" + System.nanoTime() + "ip" + System.nanoTime() + "icon"; }
        boolean isLan() { return lan; }
    }

    enum ConnectionType { OTHER, LAN, REALM }

    static final class ModernServerData {
        private final String address;
        private final ConnectionType type;

        ModernServerData(String name, String address, ConnectionType type) {
            this.address = address;
            this.type = type;
        }

        String keys() { return "name" + System.nanoTime() + "ip" + System.nanoTime() + "icon"; }
        boolean isLan() { return type == ConnectionType.LAN; }
    }

    public static void main(String[] args) throws Exception {
        Path lease = Paths.get(args[0]);
        ServerData saved = new ServerData("Saved before joining", ROOM, false);
        ServerData next = new ServerData("Other room", NEXT_ROOM, false);
        ServerData external = new ServerData("Public", "example.org:58488", false);
        ModernServerData savedModern = new ModernServerData("Saved before joining", ROOM, ConnectionType.OTHER);
        ModernServerData nextModern = new ModernServerData("Other room", NEXT_ROOM, ConnectionType.OTHER);
        ModernServerData externalModern = new ModernServerData("Public", "example.org:58488", ConnectionType.OTHER);
        require(!saved.isLan(), "No active room");
        require(!savedModern.isLan(), "No active modern room");
        write(lease, ROOM, 15000);
        require(saved.isLan() && !next.isLan() && !external.isLan(), "Only the active room");
        require(savedModern.isLan() && !nextModern.isLan() && !externalModern.isLan(), "Only the active modern room");
        require(new ServerData("Manual", ROOM, false).isLan(), "Manual address while in room");
        require(new ModernServerData("Manual", ROOM, ConnectionType.OTHER).isLan(), "Modern manual address while in room");
        write(lease, NEXT_ROOM, 15000);
        require(!saved.isLan() && next.isLan(), "Previously saved entries follow the room switch");
        require(!savedModern.isLan() && nextModern.isLan(), "Modern saved entries follow the room switch");
        write(lease, NEXT_ROOM, -2000);
        require(!next.isLan(), "Expired room");
        require(!nextModern.isLan(), "Expired modern room");
        Files.delete(lease);
        require(!next.isLan(), "Left room");
        require(!nextModern.isLan(), "Left modern room");
        require(new ServerData("Discovered", ROOM, true).isLan(), "Ordinary LAN discovery");
        require(new ModernServerData("Discovered", ROOM, ConnectionType.LAN).isLan(), "Modern ordinary LAN discovery");
        System.out.println("PASS saved entries follow the active room without restarting Java");
    }

    private static void write(Path lease, String address, long duration) throws Exception {
        Files.write(lease, (address + "\n" + (System.currentTimeMillis() + duration) + "\n")
            .getBytes(StandardCharsets.US_ASCII));
    }

    private static void require(boolean condition, String description) {
        if (!condition) throw new AssertionError(description);
    }
}

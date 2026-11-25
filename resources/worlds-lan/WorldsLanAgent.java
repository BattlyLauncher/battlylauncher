package com.battlylauncher.worlds;

import java.lang.instrument.ClassFileTransformer;
import java.lang.instrument.Instrumentation;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.ProtectionDomain;
import java.util.HashSet;
import java.util.Set;
import java.util.jar.JarFile;
import org.objectweb.asm.*;

/** Preserve Minecraft's LAN connection semantics only for this World's local tunnel. */
public final class WorldsLanAgent implements ClassFileTransformer {
    private static Path roomFile;
    public static void premain(String target, Instrumentation instrumentation) throws Exception {
        if (target == null) return;
        if (target.startsWith("room-file:")) {
            if (!Paths.get(target.substring("room-file:".length())).isAbsolute()) return;
        } else if (!validLocalAddress(target)) {
            return;
        }
        // Minecraft's isolated loaders must see the tiny helper too.
        instrumentation.appendToBootstrapClassLoaderSearch(new JarFile(
            new java.io.File(WorldsLanAgent.class.getProtectionDomain().getCodeSource().getLocation().toURI())));
        Class<?> helper = Class.forName(WorldsLanAgent.class.getName(), true, null);
        helper.getMethod("install", String.class, Instrumentation.class).invoke(null, target, instrumentation);
    }
    public static void install(String target, Instrumentation instrumentation) {
        if (target.startsWith("room-file:")) {
            roomFile = Paths.get(target.substring("room-file:".length()));
        } else {
            System.setProperty("battly.worlds.localRoom", target);
        }
        instrumentation.addTransformer(new WorldsLanAgent());
    }
    private static boolean validLocalAddress(String address) {
        if (address == null || !address.matches("127\\.0\\.0\\.1:[0-9]{1,5}")) return false;
        int port = Integer.parseInt(address.substring("127.0.0.1:".length()));
        return port >= 1 && port <= 65535;
    }
    private static boolean matchesActiveRoom(String candidate) {
        if (!validLocalAddress(candidate)) return false;
        if (roomFile == null) return candidate.equals(System.getProperty("battly.worlds.localRoom"));
        try (java.io.InputStream input = Files.newInputStream(roomFile)) {
            byte[] bytes = new byte[80];
            int size = 0;
            while (size < bytes.length) {
                int count = input.read(bytes, size, bytes.length - size);
                if (count < 0) break;
                size += count;
            }
            if (size == bytes.length) return false;
            String[] lines = new String(bytes, 0, size, StandardCharsets.US_ASCII).split("\n");
            return lines.length == 2 && candidate.equals(lines[0])
                && Long.parseLong(lines[1]) > System.currentTimeMillis();
        } catch (java.io.IOException | IllegalArgumentException | SecurityException error) {
            return false;
        }
    }
    public static boolean local(String candidate, boolean original) {
        return original || matchesActiveRoom(candidate);
    }
    public static Object localType(String candidate, Object original) {
        if (!(original instanceof Enum) || !matchesActiveRoom(candidate)) return original;
        for (Object value : original.getClass().getEnumConstants())
            if ("LAN".equals(((Enum<?>) value).name())) return value;
        return original;
    }
    /** Only JDK types may be referenced by transformed game classes. Fabric rejects
     * direct references to agent classes even when they are on the bootstrap path. */
    private static void invokeLocal(MethodVisitor visitor, boolean legacy, String owner, String field) {
        invokeLocal(visitor, legacy, owner, field, null);
    }
    private static void invokeLocal(MethodVisitor visitor, boolean legacy, String owner, String field,
                                    String addressField) {
        invokeLocal(visitor, legacy, owner, field, addressField, legacy ? "Z" : null);
    }
    private static void invokeLocal(MethodVisitor visitor, boolean legacy, String owner, String field,
                                    String addressField, String fieldDescriptor) {
        visitor.visitLdcInsn("com.battlylauncher.worlds.WorldsLanAgent");
        visitor.visitInsn(Opcodes.ICONST_1);
        visitor.visitInsn(Opcodes.ACONST_NULL);
        visitor.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/Class", "forName", "(Ljava/lang/String;ZLjava/lang/ClassLoader;)Ljava/lang/Class;", false);
        visitor.visitLdcInsn(legacy ? "local" : "localType");
        visitor.visitInsn(Opcodes.ICONST_2);
        visitor.visitTypeInsn(Opcodes.ANEWARRAY, "java/lang/Class");
        visitor.visitInsn(Opcodes.DUP); visitor.visitInsn(Opcodes.ICONST_0);
        visitor.visitLdcInsn(Type.getType(String.class)); visitor.visitInsn(Opcodes.AASTORE);
        visitor.visitInsn(Opcodes.DUP); visitor.visitInsn(Opcodes.ICONST_1);
        if (legacy) visitor.visitFieldInsn(Opcodes.GETSTATIC, "java/lang/Boolean", "TYPE", "Ljava/lang/Class;");
        else visitor.visitLdcInsn(Type.getType(Object.class));
        visitor.visitInsn(Opcodes.AASTORE);
        visitor.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/Class", "getMethod", "(Ljava/lang/String;[Ljava/lang/Class;)Ljava/lang/reflect/Method;", false);
        visitor.visitInsn(Opcodes.ACONST_NULL);
        visitor.visitInsn(Opcodes.ICONST_2); visitor.visitTypeInsn(Opcodes.ANEWARRAY, "java/lang/Object");
        visitor.visitInsn(Opcodes.DUP); visitor.visitInsn(Opcodes.ICONST_0);
        if (addressField == null) visitor.visitVarInsn(Opcodes.ALOAD, 2);
        else {
            visitor.visitVarInsn(Opcodes.ALOAD, 0);
            visitor.visitFieldInsn(Opcodes.GETFIELD, owner, addressField, "Ljava/lang/String;");
        }
        visitor.visitInsn(Opcodes.AASTORE);
        visitor.visitInsn(Opcodes.DUP); visitor.visitInsn(Opcodes.ICONST_1);
        if (field != null) {
            visitor.visitVarInsn(Opcodes.ALOAD, 0);
            visitor.visitFieldInsn(Opcodes.GETFIELD, owner, field, fieldDescriptor);
        } else visitor.visitVarInsn(legacy ? Opcodes.ILOAD : Opcodes.ALOAD, 3);
        if (legacy) visitor.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/Boolean", "valueOf", "(Z)Ljava/lang/Boolean;", false);
        visitor.visitInsn(Opcodes.AASTORE);
        visitor.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/reflect/Method", "invoke", "(Ljava/lang/Object;[Ljava/lang/Object;)Ljava/lang/Object;", false);
        if (legacy) {
            visitor.visitTypeInsn(Opcodes.CHECKCAST, "java/lang/Boolean");
            visitor.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/Boolean", "booleanValue", "()Z", false);
        }
    }
    @Override public byte[] transform(ClassLoader loader, String name, Class<?> type,
                                      ProtectionDomain domain, byte[] bytes) {
        if (name == null || (name.indexOf('/') >= 0 && !name.startsWith("net/minecraft/"))) return null;
        try {
            // The ServerData NBT keys survive Mojang/Forge/Fabric obfuscation.
            String pool = new String(bytes, java.nio.charset.StandardCharsets.ISO_8859_1);
            if (!pool.contains("icon") || !pool.contains("ip") || !pool.contains("name")) return null;
            ClassReader reader = new ClassReader(bytes);
            final Set<String> strings = new HashSet<String>();
            final String[] legacyLanField = {null};
            final String[] legacyAddressField = {null};
            final String[] typeField = {null};
            final String[] typeAddressField = {null};
            final Type[] connectionType = {null};
            reader.accept(new ClassVisitor(Opcodes.ASM9) {
                @Override public MethodVisitor visitMethod(int a, String n, String d, String s, String[] e) {
                    Type[] arguments = Type.getArgumentTypes(d);
                    boolean constructor = "<init>".equals(n) && arguments.length == 3 &&
                        arguments[0].equals(Type.getType(String.class)) && arguments[1].equals(arguments[0]);
                    boolean legacy = constructor && arguments[2].getSort() == Type.BOOLEAN;
                    boolean modern = constructor && arguments[2].getSort() == Type.OBJECT;
                    return new MethodVisitor(Opcodes.ASM9) {
                        boolean lanArgument;
                        boolean addressArgument;
                        @Override public void visitVarInsn(int opcode, int slot) {
                            lanArgument = slot == 3 && ((legacy && opcode == Opcodes.ILOAD) || (modern && opcode == Opcodes.ALOAD));
                            addressArgument = (legacy || modern) && opcode == Opcodes.ALOAD && slot == 2;
                        }
                        @Override public void visitFieldInsn(int opcode, String owner, String field, String desc) {
                            if (opcode == Opcodes.PUTFIELD && reader.getClassName().equals(owner)) {
                                if (lanArgument && legacy && "Z".equals(desc)) legacyLanField[0] = field;
                                if (lanArgument && modern && arguments[2].getDescriptor().equals(desc)) {
                                    typeField[0] = field;
                                    connectionType[0] = arguments[2];
                                }
                                if (addressArgument && "Ljava/lang/String;".equals(desc)) {
                                    if (legacy) legacyAddressField[0] = field;
                                    else typeAddressField[0] = field;
                                }
                            }
                            lanArgument = false;
                            addressArgument = false;
                        }
                        @Override public void visitLdcInsn(Object value) { if (value instanceof String) strings.add((String)value); }
                    };
                }
            }, ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);
            if (!strings.contains("ip") || !strings.contains("name") || !strings.contains("icon")) return null;
            final boolean[] changed = {false};
            ClassWriter writer = new ClassWriter(reader, ClassWriter.COMPUTE_MAXS);
            reader.accept(new ClassVisitor(Opcodes.ASM9, writer) {
                @Override public MethodVisitor visitMethod(int a, String n, String d, String s, String[] e) {
                    MethodVisitor next = super.visitMethod(a,n,d,s,e);
                    Type[] args = Type.getArgumentTypes(d);
                    if (roomFile != null) {
                        if (!"()Z".equals(d) || (a & Opcodes.ACC_STATIC) != 0) return next;
                        // Read the active room when Minecraft connects, including saved entries created before joining.
                        return new MethodVisitor(Opcodes.ASM9, next) {
                            @Override public void visitFieldInsn(int opcode, String owner, String field, String desc) {
                                if (opcode != Opcodes.GETFIELD || !reader.getClassName().equals(owner)) {
                                    super.visitFieldInsn(opcode, owner, field, desc);
                                    return;
                                }
                                boolean legacy = legacyAddressField[0] != null && field.equals(legacyLanField[0]) && "Z".equals(desc);
                                boolean modern = typeAddressField[0] != null && field.equals(typeField[0]) &&
                                    connectionType[0].getDescriptor().equals(desc);
                                if (legacy || modern) {
                                    changed[0] = true;
                                    visitInsn(Opcodes.POP);
                                    invokeLocal(this.mv, legacy, owner, field,
                                        legacy ? legacyAddressField[0] : typeAddressField[0], desc);
                                    if (modern) visitTypeInsn(Opcodes.CHECKCAST, connectionType[0].getInternalName());
                                } else super.visitFieldInsn(opcode, owner, field, desc);
                            }
                        };
                    }
                    if ("<init>".equals(n) && "(Ljava/lang/String;Ljava/lang/String;)V".equals(d) && legacyLanField[0] != null) {
                        changed[0] = true;
                        return new MethodVisitor(Opcodes.ASM9, next) {
                            @Override public void visitInsn(int opcode) {
                                if (opcode == Opcodes.RETURN) {
                                    visitVarInsn(Opcodes.ALOAD,0);
                                    invokeLocal(this, true, reader.getClassName(), legacyLanField[0]);
                                    visitFieldInsn(Opcodes.PUTFIELD,reader.getClassName(),legacyLanField[0],"Z");
                                }
                                super.visitInsn(opcode);
                            }
                        };
                    }
                    if (!"<init>".equals(n) || args.length != 3 || !args[0].equals(Type.getType(String.class)) || !args[1].equals(args[0])) return next;
                    final boolean legacy = args[2].getSort() == Type.BOOLEAN;
                    if (!legacy && args[2].getSort() != Type.OBJECT) return next;
                    final String enumName = legacy ? null : args[2].getInternalName();
                    changed[0] = true;
                    return new MethodVisitor(Opcodes.ASM9, next) {
                        @Override public void visitCode() {
                            super.visitCode();
                            invokeLocal(this, legacy, null, null);
                            if (!legacy) visitTypeInsn(Opcodes.CHECKCAST,enumName);
                            visitVarInsn(legacy ? Opcodes.ISTORE : Opcodes.ASTORE,3);
                        }
                    };
                }
            },0);
            if (!changed[0]) return null;
            System.out.println(roomFile != null
                ? "[BattlyWorlds/INFO] LAN adapter ready for room changes"
                : "[BattlyWorlds/INFO] Local room connection uses LAN mode");
            return writer.toByteArray();
        } catch (Throwable error) {
            System.out.println("[BattlyWorlds/WARN] LAN connection adapter unavailable: " + error.getClass().getSimpleName());
            return null;
        }
    }
}

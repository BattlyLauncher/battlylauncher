import org.objectweb.asm.*;import java.nio.file.*;
/** Repairs only the known BatMod startup class; keeps resource reload completion intact. */
public final class BatModStartupPatch {
 static final String MC="AKnHvCEvff0plRZMvivJHI1Y16hUOHf1ple94i52Q2QOBbkkTa9CdhlfxOJQmuqBGcGc4Btt3nXUKX1ypstf7VYEhFEpOcflQPhB";
 static final String BASE="fLmGOkwOPmHOap4nPTkouovf2QA5jja1joaM8iQnhYAAvE9eWq7nXGgibwTZ8mII2fyn3iqZSpaM47p9AIjhmoIqHu0IlGjSnJ9x";
 static final String NORMAL="IoX2nKH34AzdsHi72anXOGUBVlFBOfdfwWTAIdEmmxq5lQ1UpUEtkimm0pOJsqnFv2R2DgbYKYivfIF24kVduNTpE5mjFlRqpID9";
 static final String RELOAD="NSnOtzyiZeShzg3vOfkhTvOpoWwhmfRxSwOSwl4saovfEDdmgpWexTiITT4OC3J9QdcdZfIk8bx3pGomzAY0Uows4dRxUHCa5Wzc";
 static final String FIELD="LU8Huv8dNJpML2JB8fJWzj9J43KolrD8eyRsYcSdQZ3KH8jshbGfdwvq3RpIPDuukZZv21DROpftzYXoq05vVeGAMsPHlkNSkgtN";
 public static void main(String[] a)throws Exception{ClassReader r=new ClassReader(Files.readAllBytes(Paths.get(a[0])));ClassWriter w=new ClassWriter(r,ClassWriter.COMPUTE_MAXS);final int[] matches={0};r.accept(new ClassVisitor(Opcodes.ASM9,w){
 public MethodVisitor visitMethod(int access,String name,String desc,String sig,String[] ex){MethodVisitor v=super.visitMethod(access,name,desc,sig,ex);return new MethodVisitor(Opcodes.ASM9,v){boolean replacing;
 public void visitTypeInsn(int op,String type){if(op==Opcodes.NEW&&type.equals(NORMAL)){replacing=true;matches[0]++;return;}super.visitTypeInsn(op,type);}
 public void visitInsn(int op){if(!replacing)super.visitInsn(op);}
 public void visitVarInsn(int op,int var){if(!replacing)super.visitVarInsn(op,var);}
 public void visitMethodInsn(int op,String owner,String n,String d,boolean itf){if(!replacing)super.visitMethodInsn(op,owner,n,d,itf);}
 public void visitFieldInsn(int op,String owner,String n,String d){if(replacing){if(op!=Opcodes.PUTFIELD||!n.equals(FIELD))throw new IllegalStateException("Unexpected renderer assignment");replacing=false;super.visitMethodInsn(Opcodes.INVOKESPECIAL,MC,"battlyKeepResourceLoadingScreen","()V",false);}else super.visitFieldInsn(op,owner,n,d);}
 };}
 public void visitEnd(){MethodVisitor m=super.visitMethod(Opcodes.ACC_PRIVATE,"battlyKeepResourceLoadingScreen","()V",null,null);m.visitCode();Label done=new Label();m.visitVarInsn(Opcodes.ALOAD,0);m.visitFieldInsn(Opcodes.GETFIELD,MC,FIELD,"L"+BASE+";");m.visitTypeInsn(Opcodes.INSTANCEOF,RELOAD);m.visitJumpInsn(Opcodes.IFNE,done);m.visitVarInsn(Opcodes.ALOAD,0);m.visitTypeInsn(Opcodes.NEW,NORMAL);m.visitInsn(Opcodes.DUP);m.visitVarInsn(Opcodes.ALOAD,0);m.visitMethodInsn(Opcodes.INVOKESPECIAL,NORMAL,"<init>","(L"+MC+";)V",false);m.visitFieldInsn(Opcodes.PUTFIELD,MC,FIELD,"L"+BASE+";");m.visitLabel(done);m.visitFrame(Opcodes.F_SAME,0,null,0,null);m.visitInsn(Opcodes.RETURN);m.visitMaxs(4,1);m.visitEnd();super.visitEnd();}
 },0);if(matches[0]!=1)throw new IllegalStateException("Unexpected assignment count: "+matches[0]);Files.write(Paths.get(a[1]),w.toByteArray());}
}
